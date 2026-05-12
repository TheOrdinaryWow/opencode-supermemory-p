import type { AppError } from "../shared/errors.js";
import type { Result } from "../shared/result.js";
import { supermemoryClient as resultClient } from "../memory/client.js";
import type { ConversationMessage, MemoryType } from "../types/index.js";

export * from "../memory/client.js";

// Legacy adapter: unwraps Result and returns old legacy shape.
// Used by src/index.ts until T19 refactors tool modes.
export function unwrapOrLegacyShape<T, F>(result: Result<T, AppError>, fallback: F): T | F {
  return result.ok ? result.value : fallback;
}

type LegacyFailure<T = object> = { success: false; error: string } & T;

export const supermemoryClient = {
  async searchMemories(query: string, containerTag: string) {
    const fallback: LegacyFailure<{ results: never[]; total: number; timing: number }> = {
      success: false as const,
      error: "Failed to search memories",
      results: [],
      total: 0,
      timing: 0,
    };
    return unwrapOrLegacyShape(await resultClient.searchMemories(query, containerTag), fallback);
  },

  async getProfile(containerTag: string, query?: string) {
    const fallback: LegacyFailure<{ profile: null }> = {
      success: false as const,
      error: "Failed to fetch profile",
      profile: null,
    };
    return unwrapOrLegacyShape(await resultClient.getProfile(containerTag, query), fallback);
  },

  async addMemory(content: string, containerTag: string, metadata?: { type?: MemoryType; tool?: string; [key: string]: unknown }) {
    const fallback: LegacyFailure = {
      success: false as const,
      error: "Failed to add memory",
    };
    return unwrapOrLegacyShape(await resultClient.addMemory(content, containerTag, metadata), fallback);
  },

  async deleteMemory(memoryId: string) {
    const fallback: LegacyFailure = {
      success: false,
      error: "Failed to delete memory",
    };
    return unwrapOrLegacyShape(await resultClient.deleteMemory(memoryId), fallback);
  },

  async listMemories(containerTag: string, limit = 20) {
    const fallback: LegacyFailure<{ memories: never[]; pagination: { currentPage: number; totalItems: number; totalPages: number } }> = {
      success: false as const,
      error: "Failed to list memories",
      memories: [],
      pagination: { currentPage: 1, totalItems: 0, totalPages: 0 },
    };
    return unwrapOrLegacyShape(await resultClient.listMemories(containerTag, limit), fallback);
  },

  async ingestConversation(
    conversationId: string,
    messages: ConversationMessage[],
    containerTags: string[],
    metadata?: Record<string, string | number | boolean>,
  ) {
    const fallback: LegacyFailure = {
      success: false as const,
      error: "Failed to ingest conversation",
    };
    return unwrapOrLegacyShape(await resultClient.ingestConversation(conversationId, messages, containerTags, metadata), fallback);
  },
};
