// Compaction shim. The pure pieces (state / threshold / prompt / finder /
// message-store) live under src/compaction/ as of T16. createCompactionHook
// itself stays here until T17 splits the orchestrator out.
import { CONFIG } from "../config.js";
import { supermemoryClient } from "./client.js";
import { log } from "./logger.js";

// Forward every public surface from the extracted modules so historical
// imports of "./services/compaction.js" keep working.
export * from "../compaction/state.js";
export * from "../compaction/message-store.js";
export * from "../compaction/threshold.js";
export * from "../compaction/prompt.js";
export * from "../compaction/finder.js";

import { createCompactionState, type CompactionState } from "../compaction/state.js";
import { getMessageDir, injectHookMessage } from "../compaction/message-store.js";
import {
  COMPACTION_COOLDOWN_MS,
  DEFAULT_CONTEXT_LIMIT,
  DEFAULT_THRESHOLD,
  MIN_TOKENS_FOR_COMPACTION,
  type TokenInfo,
} from "../compaction/threshold.js";
import { createCompactionPrompt } from "../compaction/prompt.js";
import { findNearestMessageWithFields } from "../compaction/finder.js";

interface MessageInfo {
  id: string;
  role: string;
  sessionID: string;
  providerID?: string;
  modelID?: string;
  tokens?: TokenInfo;
  summary?: boolean;
  finish?: boolean;
}

interface SummarizeContext {
  sessionID: string;
  providerID: string;
  modelID: string;
  usageRatio: number;
  directory: string;
  agent?: string;
}

export interface CompactionOptions {
  threshold?: number;
  getModelLimit?: (providerID: string, modelID: string) => number | undefined;
}

export interface CompactionContext {
  directory: string;
  client: {
    session: {
      summarize: (params: {
        path: { id: string };
        body: { providerID: string; modelID: string };
        query: { directory: string };
      }) => Promise<unknown>;
      messages: (params: { path: { id: string }; query: { directory: string } }) => Promise<{ data?: Array<{ info: MessageInfo }> }>;
      promptAsync: (params: {
        path: { id: string };
        body: { agent?: string; parts: Array<{ type: string; text: string }> };
        query: { directory: string };
      }) => Promise<unknown>;
    };
    tui: {
      showToast: (params: { body: { title: string; message: string; variant: string; duration: number } }) => Promise<unknown>;
    };
  };
}

export function createCompactionHook(ctx: CompactionContext, tags: { user: string; project: string }, options?: CompactionOptions) {
  const state: CompactionState = createCompactionState();

  const threshold = options?.threshold ?? DEFAULT_THRESHOLD;
  const getModelLimit = options?.getModelLimit;

  async function fetchProjectMemoriesForCompaction(): Promise<string[]> {
    try {
      const result = await supermemoryClient.listMemories(tags.project, CONFIG.maxProjectMemories);
      const memories = result.memories || [];
      return memories.map((m) => m.summary || m.content || "").filter(Boolean);
    } catch (err) {
      log("[compaction] failed to fetch project memories", { error: String(err) });
      return [];
    }
  }

  async function injectCompactionContext(summarizeCtx: SummarizeContext): Promise<void> {
    log("[compaction] injecting context", { sessionID: summarizeCtx.sessionID });

    const projectMemories = await fetchProjectMemoriesForCompaction();
    const prompt = createCompactionPrompt(projectMemories);

    const success = injectHookMessage(summarizeCtx.sessionID, prompt, {
      agent: summarizeCtx.agent,
      model: { providerID: summarizeCtx.providerID, modelID: summarizeCtx.modelID },
      path: { cwd: summarizeCtx.directory },
    });

    if (success) {
      log("[compaction] context injected with project memories", {
        sessionID: summarizeCtx.sessionID,
        memoriesCount: projectMemories.length,
      });
    }
  }

  async function saveSummaryAsMemory(sessionID: string, summaryContent: string): Promise<void> {
    if (!summaryContent || summaryContent.length < 100) {
      log("[compaction] summary too short to save", { sessionID, length: summaryContent.length });
      return;
    }

    try {
      const result = await supermemoryClient.addMemory(`[Session Summary]\n${summaryContent}`, tags.project, { type: "conversation" });

      if (result.success) {
        log("[compaction] summary saved as memory", { sessionID, memoryId: result.id });
      } else {
        log("[compaction] failed to save summary", { error: result.error });
      }
    } catch (err) {
      log("[compaction] failed to save summary", { error: String(err) });
    }
  }

  async function checkAndTriggerCompaction(sessionID: string, lastAssistant: MessageInfo): Promise<void> {
    if (state.compactionInProgress.has(sessionID)) return;

    const lastCompaction = state.lastCompactionTime.get(sessionID) ?? 0;
    if (Date.now() - lastCompaction < COMPACTION_COOLDOWN_MS) return;

    if (lastAssistant.summary === true) return;

    const tokens = lastAssistant.tokens;
    if (!tokens) return;

    let modelID = lastAssistant.modelID ?? "";
    let providerID = lastAssistant.providerID ?? "";
    let agent: string | undefined;

    // Fallback: find model/agent from stored messages if not available
    const messageDir = getMessageDir(sessionID);
    const storedMessage = messageDir ? findNearestMessageWithFields(messageDir) : null;

    if (!providerID || !modelID) {
      if (storedMessage?.model?.providerID) providerID = storedMessage.model.providerID;
      if (storedMessage?.model?.modelID) modelID = storedMessage.model.modelID;
    }
    agent = storedMessage?.agent;

    const configLimit = getModelLimit?.(providerID, modelID);
    const contextLimit = configLimit ?? DEFAULT_CONTEXT_LIMIT;
    const totalUsed = tokens.input + tokens.cache.read + tokens.output;

    if (totalUsed < MIN_TOKENS_FOR_COMPACTION) return;

    const usageRatio = totalUsed / contextLimit;

    log("[compaction] checking", {
      sessionID,
      totalUsed,
      contextLimit,
      usageRatio: usageRatio.toFixed(2),
      threshold,
    });

    if (usageRatio < threshold) return;

    state.compactionInProgress.add(sessionID);
    state.lastCompactionTime.set(sessionID, Date.now());

    if (!providerID || !modelID) {
      state.compactionInProgress.delete(sessionID);
      return;
    }

    await ctx.client.tui
      .showToast({
        body: {
          title: "Preemptive Compaction",
          message: `Context at ${(usageRatio * 100).toFixed(0)}% - compacting with Supermemory context...`,
          variant: "warning",
          duration: 3000,
        },
      })
      .catch(() => {});

    log("[compaction] triggering compaction", { sessionID, usageRatio });

    try {
      await injectCompactionContext({
        sessionID,
        providerID,
        modelID,
        usageRatio,
        directory: ctx.directory,
        agent,
      });

      state.summarizedSessions.add(sessionID);

      await ctx.client.session.summarize({
        path: { id: sessionID },
        body: { providerID, modelID },
        query: { directory: ctx.directory },
      });

      await ctx.client.tui
        .showToast({
          body: {
            title: "Compaction Complete",
            message: "Session compacted with Supermemory context. Resuming...",
            variant: "success",
            duration: 2000,
          },
        })
        .catch(() => {});

      state.compactionInProgress.delete(sessionID);

      setTimeout(async () => {
        try {
          const messageDir = getMessageDir(sessionID);
          const storedMessage = messageDir ? findNearestMessageWithFields(messageDir) : null;

          await ctx.client.session.promptAsync({
            path: { id: sessionID },
            body: {
              agent: storedMessage?.agent,
              parts: [{ type: "text", text: "Continue" }],
            },
            query: { directory: ctx.directory },
          });
        } catch {}
      }, 500);
    } catch (err) {
      log("[compaction] compaction failed", { sessionID, error: String(err) });
      state.compactionInProgress.delete(sessionID);
    }
  }

  async function handleSummaryMessage(sessionID: string, _messageInfo: MessageInfo): Promise<void> {
    log("[compaction] handleSummaryMessage called", { sessionID, inSet: state.summarizedSessions.has(sessionID) });

    if (!state.summarizedSessions.has(sessionID)) return;

    state.summarizedSessions.delete(sessionID);
    log("[compaction] capturing summary for memory", { sessionID });

    try {
      const resp = await ctx.client.session.messages({
        path: { id: sessionID },
        query: { directory: ctx.directory },
      });

      const messages = (resp.data ?? resp) as Array<{ info: MessageInfo; parts?: Array<{ type: string; text?: string }> }>;

      const summaryMessage = messages.find((m) => m.info.role === "assistant" && m.info.summary === true);

      log("[compaction] looking for summary message", {
        sessionID,
        found: !!summaryMessage,
        hasParts: !!summaryMessage?.parts,
      });

      if (summaryMessage?.parts) {
        const textParts = summaryMessage.parts.filter((p) => p.type === "text" && p.text);
        const summaryContent = textParts.map((p) => p.text).join("\n");

        log("[compaction] summary content", {
          sessionID,
          textPartsCount: textParts.length,
          contentLength: summaryContent.length,
        });

        if (summaryContent) {
          await saveSummaryAsMemory(sessionID, summaryContent);
        }
      }
    } catch (err) {
      log("[compaction] failed to capture summary", { error: String(err) });
    }
  }

  return {
    async event({ event }: { event: { type: string; properties?: unknown } }) {
      const props = event.properties as Record<string, unknown> | undefined;

      if (event.type === "session.deleted") {
        const sessionInfo = props?.info as { id?: string } | undefined;
        if (sessionInfo?.id) {
          state.lastCompactionTime.delete(sessionInfo.id);
          state.compactionInProgress.delete(sessionInfo.id);
          state.summarizedSessions.delete(sessionInfo.id);
        }
        return;
      }

      if (event.type === "message.updated") {
        const info = props?.info as MessageInfo | undefined;
        if (!info) return;

        const sessionID = info.sessionID;
        if (!sessionID) return;

        if (info.role === "assistant" && info.summary === true && info.finish) {
          await handleSummaryMessage(sessionID, info);
          return;
        }

        if (info.role !== "assistant" || !info.finish) return;

        await checkAndTriggerCompaction(sessionID, info);
        return;
      }

      if (event.type === "session.idle") {
        const sessionID = props?.sessionID as string | undefined;
        if (!sessionID) return;

        try {
          const resp = await ctx.client.session.messages({
            path: { id: sessionID },
            query: { directory: ctx.directory },
          });

          const messages = (resp.data ?? resp) as Array<{ info: MessageInfo }>;
          const assistants = messages.filter((m) => m.info.role === "assistant").map((m) => m.info);

          if (assistants.length === 0) return;

          const lastAssistant = assistants[assistants.length - 1];

          if (!lastAssistant.providerID || !lastAssistant.modelID) {
            const messageDir = getMessageDir(sessionID);
            const storedMessage = messageDir ? findNearestMessageWithFields(messageDir) : null;
            if (storedMessage?.model?.providerID && storedMessage?.model?.modelID) {
              lastAssistant.providerID = storedMessage.model.providerID;
              lastAssistant.modelID = storedMessage.model.modelID;
            }
          }

          await checkAndTriggerCompaction(sessionID, lastAssistant);
        } catch {}
      }
    },
  };
}
