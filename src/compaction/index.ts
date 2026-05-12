import { CONFIG } from "../config.js";
import { supermemoryClient } from "../services/client.js";
import { defaultLogger as logger } from "../shared/logger.js";
import { findNearestMessageWithFields } from "./finder.js";
import { getMessageDir, injectHookMessage } from "./message-store.js";
import { createCompactionPrompt } from "./prompt.js";
import { createCompactionState, type CompactionState } from "./state.js";
import { DEFAULT_CONTEXT_LIMIT, DEFAULT_THRESHOLD, computeShouldCompact, type TokenInfo } from "./threshold.js";

export interface MessageInfo {
  id: string;
  role: string;
  sessionID: string;
  providerID?: string;
  modelID?: string;
  tokens?: TokenInfo;
  summary?: boolean;
  finish?: boolean;
}

export interface SummarizeContext {
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
      summarize: (params: { path: { id: string }; body: { providerID: string; modelID: string }; query: { directory: string } }) => Promise<unknown>;
      messages: (params: { path: { id: string }; query: { directory: string } }) => Promise<{ data?: Array<{ info: MessageInfo; parts?: Array<{ type: string; text?: string }> }> }>;
      promptAsync: (params: { path: { id: string }; body: { agent?: string; parts: Array<{ type: string; text: string }> }; query: { directory: string } }) => Promise<unknown>;
    };
    tui: {
      showToast: (params: { body: { title: string; message: string; variant: string; duration: number } }) => Promise<unknown>;
    };
  };
}

interface HookDeps {
  ctx: CompactionContext;
  tags: { user: string; project: string };
  state: CompactionState;
  threshold: number;
  getModelLimit?: (providerID: string, modelID: string) => number | undefined;
}

export function createCompactionHook(ctx: CompactionContext, tags: { user: string; project: string }, options?: CompactionOptions) {
  const deps: HookDeps = {
    ctx,
    tags,
    state: createCompactionState(),
    threshold: options?.threshold ?? DEFAULT_THRESHOLD,
    getModelLimit: options?.getModelLimit,
  };

  return {
    async event({ event }: { event: { type: string; properties?: unknown } }) {
      const props = event.properties as Record<string, unknown> | undefined;
      if (event.type === "session.deleted") return handleSessionDeleted(deps, props);
      if (event.type === "message.updated") return handleMessageUpdated(deps, props);
      if (event.type === "session.idle") return handleSessionIdle(deps, props);
    },
  };
}

export async function handleSessionDeleted(deps: HookDeps, props?: Record<string, unknown>): Promise<void> {
  const sessionInfo = props?.info as { id?: string } | undefined;
  if (!sessionInfo?.id) return;
  deps.state.lastCompactionTime.delete(sessionInfo.id);
  deps.state.compactionInProgress.delete(sessionInfo.id);
  deps.state.summarizedSessions.delete(sessionInfo.id);
}

export async function handleMessageUpdated(deps: HookDeps, props?: Record<string, unknown>): Promise<void> {
  const info = props?.info as MessageInfo | undefined;
  if (!info?.sessionID) return;
  if (info.role === "assistant" && info.summary === true && info.finish) {
    await handleSummaryMessage(deps, info.sessionID);
    return;
  }
  if (info.role !== "assistant" || !info.finish) return;
  await performCompaction(deps, info.sessionID, info);
}

export async function handleSessionIdle(deps: HookDeps, props?: Record<string, unknown>): Promise<void> {
  const sessionID = props?.sessionID as string | undefined;
  if (!sessionID) return;
  try {
    const resp = await deps.ctx.client.session.messages({ path: { id: sessionID }, query: { directory: deps.ctx.directory } });
    const messages = (resp.data ?? resp) as Array<{ info: MessageInfo }>;
    const assistants = messages.filter((m) => m.info.role === "assistant").map((m) => m.info);
    const lastAssistant = assistants.at(-1);
    if (!lastAssistant) return;
    fillMissingModelFromStorage(sessionID, lastAssistant);
    await performCompaction(deps, sessionID, lastAssistant);
  } catch (err) {
    logger.warn("[compaction] failed to process idle session", { sessionID, error: String(err) });
  }
}

export function shouldCompact(deps: HookDeps, sessionID: string, lastAssistant: MessageInfo) {
  if (!lastAssistant.tokens) return null;
  const providerID = lastAssistant.providerID ?? "";
  const modelID = lastAssistant.modelID ?? "";
  const contextLimit = deps.getModelLimit?.(providerID, modelID) ?? DEFAULT_CONTEXT_LIMIT;
  return computeShouldCompact({
    tokens: lastAssistant.tokens,
    threshold: deps.threshold,
    contextLimit,
    lastCompactionAt: deps.state.lastCompactionTime.get(sessionID) ?? 0,
    isSummary: lastAssistant.summary === true,
    inProgress: deps.state.compactionInProgress.has(sessionID),
    now: Date.now(),
  });
}

export async function performCompaction(deps: HookDeps, sessionID: string, lastAssistant: MessageInfo): Promise<void> {
  const storedMessage = resolveStoredMessage(sessionID);
  const providerID = lastAssistant.providerID || storedMessage?.model?.providerID || "";
  const modelID = lastAssistant.modelID || storedMessage?.model?.modelID || "";
  const decision = shouldCompact(deps, sessionID, { ...lastAssistant, providerID, modelID });
  if (!decision?.shouldCompact) return;
  logger.info("[compaction] checking", { sessionID, totalUsed: decision.totalUsed, usageRatio: decision.usageRatio.toFixed(2), threshold: deps.threshold });
  deps.state.compactionInProgress.add(sessionID);
  deps.state.lastCompactionTime.set(sessionID, Date.now());
  if (!providerID || !modelID) {
    deps.state.compactionInProgress.delete(sessionID);
    return;
  }
  await warnToast(deps, decision.usageRatio);
  logger.info("[compaction] triggering compaction", { sessionID, usageRatio: decision.usageRatio });
  try {
    await injectMemoryContext(deps, { sessionID, providerID, modelID, usageRatio: decision.usageRatio, directory: deps.ctx.directory, agent: storedMessage?.agent });
    deps.state.summarizedSessions.add(sessionID);
    await deps.ctx.client.session.summarize({ path: { id: sessionID }, body: { providerID, modelID }, query: { directory: deps.ctx.directory } });
    await successToast(deps);
    deps.state.compactionInProgress.delete(sessionID);
    scheduleContinuePrompt(deps, sessionID);
  } catch (err) {
    logger.warn("[compaction] compaction failed", { sessionID, error: String(err) });
    deps.state.compactionInProgress.delete(sessionID);
  }
}

export async function injectMemoryContext(deps: HookDeps, summarizeCtx: SummarizeContext): Promise<void> {
  logger.info("[compaction] injecting context", { sessionID: summarizeCtx.sessionID });
  const projectMemories = await fetchProjectMemoriesForCompaction(deps.tags.project);
  const prompt = createCompactionPrompt(projectMemories);
  const success = injectHookMessage(summarizeCtx.sessionID, prompt, {
    agent: summarizeCtx.agent,
    model: { providerID: summarizeCtx.providerID, modelID: summarizeCtx.modelID },
    path: { cwd: summarizeCtx.directory },
  });
  if (success) logger.info("[compaction] context injected with project memories", { sessionID: summarizeCtx.sessionID, memoriesCount: projectMemories.length });
}

async function fetchProjectMemoriesForCompaction(projectTag: string): Promise<string[]> {
  try {
    const result = await supermemoryClient.listMemories(projectTag, CONFIG.maxProjectMemories);
    return (result.memories || []).map((m) => m.summary || m.content || "").filter(Boolean);
  } catch (err) {
    logger.warn("[compaction] failed to fetch project memories", { error: String(err) });
    return [];
  }
}

async function saveSummaryAsMemory(deps: HookDeps, sessionID: string, summaryContent: string): Promise<void> {
  if (!summaryContent || summaryContent.length < 100) return logger.info("[compaction] summary too short to save", { sessionID, length: summaryContent.length });
  try {
    const result = await supermemoryClient.addMemory(`[Session Summary]\n${summaryContent}`, deps.tags.project, { type: "conversation" });
    if (result.success) logger.info("[compaction] summary saved as memory", { sessionID, memoryId: result.id });
    else logger.warn("[compaction] failed to save summary", { error: result.error });
  } catch (err) {
    logger.warn("[compaction] failed to save summary", { error: String(err) });
  }
}

async function handleSummaryMessage(deps: HookDeps, sessionID: string): Promise<void> {
  logger.info("[compaction] handleSummaryMessage called", { sessionID, inSet: deps.state.summarizedSessions.has(sessionID) });
  if (!deps.state.summarizedSessions.has(sessionID)) return;
  deps.state.summarizedSessions.delete(sessionID);
  try {
    const resp = await deps.ctx.client.session.messages({ path: { id: sessionID }, query: { directory: deps.ctx.directory } });
    const messages = (resp.data ?? resp) as Array<{ info: MessageInfo; parts?: Array<{ type: string; text?: string }> }>;
    const summaryMessage = messages.find((m) => m.info.role === "assistant" && m.info.summary === true);
    const textParts = summaryMessage?.parts?.filter((p) => p.type === "text" && p.text) ?? [];
    const summaryContent = textParts.map((p) => p.text).join("\n");
    if (summaryContent) await saveSummaryAsMemory(deps, sessionID, summaryContent);
  } catch (err) {
    logger.warn("[compaction] failed to capture summary", { error: String(err) });
  }
}

function resolveStoredMessage(sessionID: string) {
  const messageDir = getMessageDir(sessionID);
  return messageDir ? findNearestMessageWithFields(messageDir) : null;
}

function fillMissingModelFromStorage(sessionID: string, message: MessageInfo): void {
  if (message.providerID && message.modelID) return;
  const storedMessage = resolveStoredMessage(sessionID);
  if (storedMessage?.model?.providerID) message.providerID = storedMessage.model.providerID;
  if (storedMessage?.model?.modelID) message.modelID = storedMessage.model.modelID;
}

async function warnToast(deps: HookDeps, usageRatio: number): Promise<void> {
  try {
    await deps.ctx.client.tui.showToast({ body: { title: "Preemptive Compaction", message: `Context at ${(usageRatio * 100).toFixed(0)}% - compacting with Supermemory context...`, variant: "warning", duration: 3000 } });
  } catch (err) {
    logger.warn("[compaction] failed to show warning toast", { error: String(err) });
  }
}

async function successToast(deps: HookDeps): Promise<void> {
  try {
    await deps.ctx.client.tui.showToast({ body: { title: "Compaction Complete", message: "Session compacted with Supermemory context. Resuming...", variant: "success", duration: 2000 } });
  } catch (err) {
    logger.warn("[compaction] failed to show success toast", { error: String(err) });
  }
}

function scheduleContinuePrompt(deps: HookDeps, sessionID: string): void {
  setTimeout(async () => {
    try {
      const storedMessage = resolveStoredMessage(sessionID);
      await deps.ctx.client.session.promptAsync({ path: { id: sessionID }, body: { agent: storedMessage?.agent, parts: [{ type: "text", text: "Continue" }] }, query: { directory: deps.ctx.directory } });
    } catch (err) {
      logger.warn("[compaction] failed to continue after compaction", { sessionID, error: String(err) });
    }
  }, 500);
}
