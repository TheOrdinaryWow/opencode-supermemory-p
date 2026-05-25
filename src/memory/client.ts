import { homedir } from "node:os";
import { join } from "node:path";

import { getLogger } from "@logtape/logtape";
import Supermemory from "supermemory";

import { getConfig } from "@/config/loader";
import { detectCategory } from "@/memory/category";
import { createDedupCache, type DedupCache } from "@/memory/dedup";
import { clampEntityContext } from "@/memory/entity-context";
import type { AppError } from "@/shared/errors";
import { redactedPreview } from "@/shared/redact";
import { err, ok, type Result } from "@/shared/result";
import { withTimeout } from "@/shared/timeout";
import type { ConversationIngestResponse, ConversationMessage, MemorySource, MemoryType } from "@/types/index";

const logger = getLogger(["supermemory", "memory", "client"]);

const TIMEOUT_MS = 5000;
const INGEST_TIMEOUT_MS = 30000;
const MAX_CONVERSATION_CHARS = 100_000;
const DEDUP_DATA_DIR = join(homedir(), ".local", "share", "opencode-supermemory-p");

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAuthError(message: string): boolean {
  return /\b(401|403|unauthorized|forbidden)\b/i.test(message);
}

function toAppError(error: unknown): AppError {
  const message = errorMessage(error);
  if (isAuthError(message)) {
    return { kind: "AuthError", message, cause: error };
  }
  return { kind: "NetworkError", message, cause: error };
}

function validationError(message: string): AppError {
  return { kind: "ValidationError", message };
}

async function withResult<T>(label: string, fn: () => Promise<T>): Promise<Result<T, AppError>> {
  try {
    return ok(await fn());
  } catch (error) {
    const appError = toAppError(error);
    logger.info(`${label}: error`, { error: appError.message });
    return err(appError);
  }
}

export type SearchMemoriesResult = Awaited<ReturnType<Supermemory["search"]["memories"]>> & { success: true };
export type ProfileResult = Awaited<ReturnType<Supermemory["profile"]>> & { success: true };
export type AddMemoryResult = Partial<Awaited<ReturnType<Supermemory["add"]>>> & { success: true; id?: string; deduped?: true };
export type DeleteMemoryResult = { success: true };
export type ListMemoriesResult = Awaited<ReturnType<Supermemory["documents"]["list"]>> & { success: true };
export type IngestConversationResult = ConversationIngestResponse & { success: true; storedMemoryIds: string[] };

type AddMemoryMetadata = { type?: MemoryType; tool?: string; source?: MemorySource; [key: string]: unknown };

interface SupermemoryClientOptions {
  dedupCache?: DedupCache;
}

export class SupermemoryClient {
  private client: Supermemory | null = null;
  private dedupCache?: DedupCache;

  constructor(options: SupermemoryClientOptions = {}) {
    this.dedupCache = options.dedupCache;
  }

  private getDedupCache(config: ReturnType<typeof getConfig>): DedupCache {
    this.dedupCache ??= createDedupCache({
      dedupEnabled: config.dedupEnabled,
      dedupCacheSize: config.dedupCacheSize,
      dataDir: DEDUP_DATA_DIR,
    });
    return this.dedupCache;
  }

  private formatConversationMessage(message: ConversationMessage): string {
    const content =
      typeof message.content === "string"
        ? message.content
        : message.content.map((part) => (part.type === "text" ? part.text : `[image] ${part.imageUrl.url}`)).join("\n");

    const trimmed = content.trim();
    if (trimmed.length === 0) {
      return `[${message.role}]`;
    }
    return `[${message.role}] ${trimmed}`;
  }

  private formatConversationTranscript(messages: ConversationMessage[]): string {
    return messages.map((message, idx) => `${idx + 1}. ${this.formatConversationMessage(message)}`).join("\n");
  }

  private getClient(): Supermemory {
    if (!this.client) {
      const config = getConfig();
      if (!config.apiKey) {
        throw new Error("SUPERMEMORY_API_KEY not set");
      }
      this.client = new Supermemory({ apiKey: config.apiKey });
      this.client.settings.update({
        shouldLLMFilter: true,
        filterPrompt: config.filterPrompt,
      });
    }
    return this.client;
  }

  async searchMemories(query: string, containerTag: string | string[]): Promise<Result<SearchMemoriesResult, AppError>> {
    if (Array.isArray(containerTag)) {
      return withResult("searchMemories", async () => {
        const uniqueTags = [...new Set(containerTag)].filter((tag) => tag.length > 0);
        const results = await Promise.all(uniqueTags.map((tag) => this.searchMemories(query, tag)));
        const firstFailure = results.find((result) => !result.ok);
        if (firstFailure && !firstFailure.ok) {
          throw new Error(firstFailure.error.message);
        }

        const successful = results.filter((result): result is { ok: true; value: SearchMemoriesResult } => result.ok);
        return {
          success: true as const,
          results: successful.flatMap((result) => result.value.results ?? []),
          total: successful.reduce((total, result) => total + (result.value.results?.length ?? 0), 0),
          timing: 0,
        };
      });
    }

    const config = getConfig();
    logger.info("searchMemories: start", { containerTag });
    return withResult("searchMemories", async () => {
      const result = await withTimeout(
        this.getClient().search.memories({
          q: query,
          containerTag,
          threshold: config.similarityThreshold,
          limit: config.maxMemories,
          searchMode: "hybrid",
        }),
        TIMEOUT_MS,
        "supermemory.searchMemories",
      );
      logger.info("searchMemories: success", { count: result.results?.length || 0 });
      return { success: true as const, ...result };
    });
  }

  async getProfile(containerTag: string, query?: string): Promise<Result<ProfileResult, AppError>> {
    logger.info("getProfile: start", { containerTag });
    return withResult("getProfile", async () => {
      const result = await withTimeout(
        this.getClient().profile({
          containerTag,
          q: query,
        }),
        TIMEOUT_MS,
        "supermemory.getProfile",
      );
      logger.info("getProfile: success", { hasProfile: !!result?.profile });
      return { success: true as const, ...result };
    });
  }

  async addMemory(content: string, containerTag: string, metadata?: AddMemoryMetadata): Promise<Result<AddMemoryResult, AppError>> {
    logger.info("addMemory: start", { containerTag, contentLength: content.length, preview: redactedPreview(content) });
    return withResult("addMemory", async () => {
      const config = getConfig();
      const nextMetadata: Record<string, unknown> & { type?: string } = { ...(metadata ?? {}) };
      if (config.autoCategoryTagging === true && nextMetadata.type === undefined) {
        nextMetadata.type = detectCategory(content);
      }

      if (config.dedupEnabled && this.getDedupCache(config).has(content)) {
        logger.info("addMemory: deduped", { containerTag });
        return { success: true as const, deduped: true as const };
      }

      const metadataWithContext = {
        ...nextMetadata,
        entityContext: clampEntityContext(config.entityContext),
      };
      const result = await withTimeout(
        this.getClient().add({
          content,
          containerTag,
          metadata: metadataWithContext as Record<string, string | number | boolean | string[]>,
        }),
        TIMEOUT_MS,
        "supermemory.addMemory",
      );
      if (config.dedupEnabled) {
        this.getDedupCache(config).add(content);
      }
      logger.info("addMemory: success", { id: result.id, containerTag });
      return { success: true as const, ...result };
    });
  }

  async deleteMemory(memoryId: string, containerTag: string): Promise<Result<DeleteMemoryResult, AppError>> {
    logger.info("deleteMemory: start", { memoryId, containerTag });
    return withResult("deleteMemory", async () => {
      await withTimeout(this.getClient().memories.forget({ containerTag, id: memoryId }), TIMEOUT_MS, "supermemory.deleteMemory");
      logger.info("deleteMemory: success", { memoryId });
      return { success: true };
    });
  }

  async listMemories(containerTag: string, limit = 20): Promise<Result<ListMemoriesResult, AppError>> {
    logger.info("listMemories: start", { containerTag, limit });
    return withResult("listMemories", async () => {
      const result = await withTimeout(
        this.getClient().documents.list({
          containerTags: [containerTag],
          limit,
          order: "desc",
          sort: "createdAt",
          includeContent: true,
        }),
        TIMEOUT_MS,
        "supermemory.listMemories",
      );
      logger.info("listMemories: success", { count: result.memories?.length || 0 });
      return { success: true as const, ...result };
    });
  }

  async ingestConversation(
    conversationId: string,
    messages: ConversationMessage[],
    containerTags: string[],
    metadata?: Record<string, string | number | boolean>,
  ): Promise<Result<IngestConversationResult, AppError>> {
    logger.info("ingestConversation: start", {
      conversationId,
      messageCount: messages.length,
      containerTags,
    });

    if (messages.length === 0) {
      return err(validationError("No messages to ingest"));
    }

    const uniqueTags = [...new Set(containerTags)].filter((tag) => tag.length > 0);
    if (uniqueTags.length === 0) {
      return err(validationError("At least one containerTag is required"));
    }

    const transcript = this.formatConversationTranscript(messages);
    const rawContent = `[Conversation ${conversationId}]\n${transcript}`;
    const content =
      rawContent.length > MAX_CONVERSATION_CHARS ? `${rawContent.slice(0, MAX_CONVERSATION_CHARS)}\n...[truncated]` : rawContent;

    const ingestMetadata = {
      type: "conversation" as const,
      conversationId,
      messageCount: messages.length,
      originalContainerTags: uniqueTags,
      ...metadata,
    };

    const savedIds: string[] = [];
    let firstError: AppError | null = null;

    for (const tag of uniqueTags) {
      let result: Result<AddMemoryResult, AppError>;
      try {
        result = await withTimeout(this.addMemory(content, tag, ingestMetadata), INGEST_TIMEOUT_MS, "supermemory.ingestConversation");
      } catch (error) {
        result = err(toAppError(error));
      }
      if (result.ok && typeof result.value.id === "string") {
        savedIds.push(result.value.id);
      } else if (!firstError) {
        firstError = result.ok
          ? ({ kind: "NetworkError", message: "Memory was deduped before ingest storage" } satisfies AppError)
          : result.error;
      }
    }

    if (savedIds.length === 0) {
      const error = firstError ?? ({ kind: "NetworkError", message: "Failed to ingest conversation" } satisfies AppError);
      logger.info("ingestConversation: error", { conversationId, error: error.message });
      return err(error);
    }

    const status = savedIds.length === uniqueTags.length ? "stored" : "partial";
    const response: ConversationIngestResponse = {
      // biome-ignore lint/style/noNonNullAssertion: `savedIds[0]` is guaranteed to exist since we check `savedIds.length === 0` above
      id: savedIds[0]!,
      conversationId,
      status,
    };

    logger.info("ingestConversation: success", {
      conversationId,
      status,
      storedCount: savedIds.length,
      requestedCount: uniqueTags.length,
    });

    return ok({
      success: true as const,
      ...response,
      storedMemoryIds: savedIds,
    });
  }
}

export const resultSupermemoryClient = new SupermemoryClient();

function unwrapOrLegacyShape<T, F extends { error: string }>(result: Result<T, AppError>, fallback: F): T | F {
  if (result.ok) return result.value;
  return { ...fallback, error: result.error.message || fallback.error };
}

type LegacyFailure<T = object> = { success: false; error: string } & T;

export const supermemoryClient = {
  async searchMemories(query: string, containerTag: string | string[]) {
    const fallback: LegacyFailure<{ results: never[]; total: number; timing: number }> = {
      success: false,
      error: "Failed to search memories",
      results: [],
      total: 0,
      timing: 0,
    };
    return unwrapOrLegacyShape(await resultSupermemoryClient.searchMemories(query, containerTag), fallback);
  },
  async getProfile(containerTag: string, query?: string) {
    return unwrapOrLegacyShape(await resultSupermemoryClient.getProfile(containerTag, query), {
      success: false as const,
      error: "Failed to fetch profile",
      profile: null,
    });
  },
  async addMemory(content: string, containerTag: string, metadata?: AddMemoryMetadata) {
    return unwrapOrLegacyShape(await resultSupermemoryClient.addMemory(content, containerTag, metadata), {
      success: false as const,
      error: "Failed to add memory",
    });
  },
  async deleteMemory(memoryId: string, containerTag: string) {
    return unwrapOrLegacyShape(await resultSupermemoryClient.deleteMemory(memoryId, containerTag), {
      success: false as const,
      error: "Failed to delete memory",
    });
  },
  async listMemories(containerTag: string, limit = 20) {
    const fallback: LegacyFailure<{ memories: never[]; pagination: { currentPage: number; totalItems: number; totalPages: number } }> = {
      success: false,
      error: "Failed to list memories",
      memories: [],
      pagination: { currentPage: 1, totalItems: 0, totalPages: 0 },
    };
    return unwrapOrLegacyShape(await resultSupermemoryClient.listMemories(containerTag, limit), fallback);
  },
  async ingestConversation(
    conversationId: string,
    messages: ConversationMessage[],
    containerTags: string[],
    metadata?: Record<string, string | number | boolean>,
  ) {
    return unwrapOrLegacyShape(await resultSupermemoryClient.ingestConversation(conversationId, messages, containerTags, metadata), {
      success: false as const,
      error: "Failed to ingest conversation",
    });
  },
};
