import Supermemory from "supermemory";

import { CONFIG, isConfigured, SUPERMEMORY_API_KEY } from "../config.js";
import type { AppError } from "../shared/errors.js";
import { log } from "../shared/logger.js";
import { err, ok, type Result } from "../shared/result.js";
import type { ConversationIngestResponse, ConversationMessage, MemoryType } from "../types/index.ts";

const TIMEOUT_MS = 30000;
const MAX_CONVERSATION_CHARS = 100_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms))]);
}

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
    log(`${label}: error`, { error: appError.message });
    return err(appError);
  }
}

export type SearchMemoriesResult = Awaited<ReturnType<Supermemory["search"]["memories"]>> & { success: true };
export type ProfileResult = Awaited<ReturnType<Supermemory["profile"]>> & { success: true };
export type AddMemoryResult = Awaited<ReturnType<Supermemory["memories"]["add"]>> & { success: true };
export type DeleteMemoryResult = { success: true };
export type ListMemoriesResult = Awaited<ReturnType<Supermemory["memories"]["list"]>> & { success: true };
export type IngestConversationResult = ConversationIngestResponse & { success: true; storedMemoryIds: string[] };

export class SupermemoryClient {
  private client: Supermemory | null = null;

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
      if (!isConfigured()) {
        throw new Error("SUPERMEMORY_API_KEY not set");
      }
      this.client = new Supermemory({ apiKey: SUPERMEMORY_API_KEY });
      this.client.settings.update({
        shouldLLMFilter: true,
        filterPrompt: CONFIG.filterPrompt,
      });
    }
    return this.client;
  }

  async searchMemories(query: string, containerTag: string): Promise<Result<SearchMemoriesResult, AppError>> {
    log("searchMemories: start", { containerTag });
    return withResult("searchMemories", async () => {
      const result = await withTimeout(
        this.getClient().search.memories({
          q: query,
          containerTag,
          threshold: CONFIG.similarityThreshold,
          limit: CONFIG.maxMemories,
          searchMode: "hybrid",
        }),
        TIMEOUT_MS,
      );
      log("searchMemories: success", { count: result.results?.length || 0 });
      return { success: true as const, ...result };
    });
  }

  async getProfile(containerTag: string, query?: string): Promise<Result<ProfileResult, AppError>> {
    log("getProfile: start", { containerTag });
    return withResult("getProfile", async () => {
      const result = await withTimeout(
        this.getClient().profile({
          containerTag,
          q: query,
        }),
        TIMEOUT_MS,
      );
      log("getProfile: success", { hasProfile: !!result?.profile });
      return { success: true as const, ...result };
    });
  }

  async addMemory(
    content: string,
    containerTag: string,
    metadata?: { type?: MemoryType; tool?: string; [key: string]: unknown },
  ): Promise<Result<AddMemoryResult, AppError>> {
    log("addMemory: start", { containerTag, contentLength: content.length });
    return withResult("addMemory", async () => {
      const result = await withTimeout(
        this.getClient().memories.add({
          content,
          containerTag,
          metadata: metadata as Record<string, string | number | boolean | string[]>,
        }),
        TIMEOUT_MS,
      );
      log("addMemory: success", { id: result.id });
      return { success: true as const, ...result };
    });
  }

  async deleteMemory(memoryId: string): Promise<Result<DeleteMemoryResult, AppError>> {
    log("deleteMemory: start", { memoryId });
    return withResult("deleteMemory", async () => {
      await withTimeout(this.getClient().memories.delete(memoryId), TIMEOUT_MS);
      log("deleteMemory: success", { memoryId });
      return { success: true };
    });
  }

  async listMemories(containerTag: string, limit = 20): Promise<Result<ListMemoriesResult, AppError>> {
    log("listMemories: start", { containerTag, limit });
    return withResult("listMemories", async () => {
      const result = await withTimeout(
        this.getClient().memories.list({
          containerTags: [containerTag],
          limit,
          order: "desc",
          sort: "createdAt",
          includeContent: true,
        }),
        TIMEOUT_MS,
      );
      log("listMemories: success", { count: result.memories?.length || 0 });
      return { success: true as const, ...result };
    });
  }

  async ingestConversation(
    conversationId: string,
    messages: ConversationMessage[],
    containerTags: string[],
    metadata?: Record<string, string | number | boolean>,
  ): Promise<Result<IngestConversationResult, AppError>> {
    log("ingestConversation: start", {
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
      const result = await this.addMemory(content, tag, ingestMetadata);
      if (result.ok) {
        savedIds.push(result.value.id);
      } else if (!firstError) {
        firstError = result.error;
      }
    }

    if (savedIds.length === 0) {
      const error = firstError ?? ({ kind: "NetworkError", message: "Failed to ingest conversation" } satisfies AppError);
      log("ingestConversation: error", { conversationId, error: error.message });
      return err(error);
    }

    const status = savedIds.length === uniqueTags.length ? "stored" : "partial";
    const response: ConversationIngestResponse = {
      id: savedIds[0]!,
      conversationId,
      status,
    };

    log("ingestConversation: success", {
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

function unwrapOrLegacyShape<T, F>(result: Result<T, AppError>, fallback: F): T | F {
  return result.ok ? result.value : fallback;
}

type LegacyFailure<T = object> = { success: false; error: string } & T;

export const supermemoryClient = {
  async searchMemories(query: string, containerTag: string) {
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
  async addMemory(content: string, containerTag: string, metadata?: { type?: MemoryType; tool?: string; [key: string]: unknown }) {
    return unwrapOrLegacyShape(await resultSupermemoryClient.addMemory(content, containerTag, metadata), {
      success: false as const,
      error: "Failed to add memory",
    });
  },
  async deleteMemory(memoryId: string) {
    return unwrapOrLegacyShape(await resultSupermemoryClient.deleteMemory(memoryId), {
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
