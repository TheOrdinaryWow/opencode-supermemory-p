import type { ProfileResponse } from "supermemory/resources";

import { getConfig } from "@/config/loader";
import type { SupermemoryConfig } from "@/config/schema";
import { formatMemoFooter } from "@/memory/footer";
import { formatRelativeTime } from "@/memory/relative-time";
import { dedupe } from "@/shared/collection";

interface MemoryResultMinimal {
  similarity?: number;
  memory?: string;
  chunk?: string;
  createdAt?: string | Date;
}

interface MemoriesResponseMinimal {
  results?: MemoryResultMinimal[];
}

function extractFactText(fact: unknown): string {
  if (typeof fact === "string") return fact;
  if (fact != null && typeof fact === "object") {
    const content = (fact as { content?: string }).content;
    if (typeof content === "string") return content;
    return JSON.stringify(fact);
  }
  return String(fact ?? "");
}

function getMemoryContent(memory: MemoryResultMinimal): string {
  return memory.memory || memory.chunk || "";
}

function normalizeFactText(text: string): string {
  return text.toLowerCase().trim();
}

function formatMemoryLine(memory: MemoryResultMinimal, useRelativeTime: boolean): string {
  const similarity = Math.round((memory.similarity ?? 0) * 100);
  const content = getMemoryContent(memory);
  const relativeTime = useRelativeTime && memory.createdAt != null ? formatRelativeTime(memory.createdAt) : "";
  const timestampSuffix = relativeTime ? ` (${relativeTime})` : "";

  return `- [${similarity}%] ${content}${timestampSuffix}`;
}

export function formatContextForPrompt(
  profile: ProfileResponse | null,
  userMemories: MemoriesResponseMinimal,
  projectMemories: MemoriesResponseMinimal,
  config: Pick<SupermemoryConfig, "injectProfile" | "maxProfileItems"> &
    Partial<Pick<SupermemoryConfig, "relativeTimeDisplay" | "profileCrossArrayDedup" | "memoUsageFooter">> = getConfig(),
): string {
  const parts: string[] = ["[SUPERMEMORY]"];
  const useRelativeTime = config.relativeTimeDisplay === true;
  let staticFactTexts: string[] = [];
  let dynamicFactTexts: string[] = [];
  const projectResults = projectMemories.results || [];
  let userResults = userMemories.results || [];

  if (config.injectProfile && profile?.profile) {
    const { static: staticFacts, dynamic: dynamicFacts } = profile.profile;
    staticFactTexts = staticFacts.slice(0, config.maxProfileItems).map(extractFactText);
    dynamicFactTexts = dynamicFacts.slice(0, config.maxProfileItems).map(extractFactText);

    if (config.profileCrossArrayDedup === true) {
      staticFactTexts = dedupe<string>(staticFactTexts);
      const staticFactKeys = new Set(staticFactTexts.map(normalizeFactText));
      dynamicFactTexts = dedupe<string>(dynamicFactTexts.filter((fact) => !staticFactKeys.has(normalizeFactText(fact))));
      const profileFactKeys = new Set([...staticFactTexts, ...dynamicFactTexts].map(normalizeFactText));
      userResults = dedupe<MemoryResultMinimal>(
        userResults.filter((memory) => !profileFactKeys.has(normalizeFactText(getMemoryContent(memory)))),
        getMemoryContent,
      );
    }

    if (staticFactTexts.length > 0) {
      parts.push("\nUser Profile:");
      staticFactTexts.forEach((text) => {
        parts.push(`- ${text}`);
      });
    }

    if (dynamicFactTexts.length > 0) {
      parts.push("\nRecent Context:");
      dynamicFactTexts.forEach((text) => {
        parts.push(`- ${text}`);
      });
    }
  }

  if (projectResults.length > 0) {
    parts.push("\nProject Knowledge:");
    projectResults.forEach((mem) => {
      parts.push(formatMemoryLine(mem, useRelativeTime));
    });
  }

  if (userResults.length > 0) {
    parts.push("\nRelevant Memories:");
    userResults.forEach((mem) => {
      parts.push(formatMemoryLine(mem, useRelativeTime));
    });
  }

  if (parts.length === 1) {
    return "";
  }

  const footer =
    config.memoUsageFooter === true
      ? formatMemoFooter({
          profile: staticFactTexts.length + dynamicFactTexts.length,
          projectMemories: projectResults.length,
          relevantMemories: userResults.length,
        })
      : "";

  if (footer) {
    parts.push(`\n${footer}`);
  }

  return parts.join("\n");
}
