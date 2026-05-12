/**
 * Builds the compaction context-injection prompt that gets prepended (as a
 * synthetic user message) to a session right before OpenCode summarises it.
 *
 * The five-section structure (User Requests / Final Goal / Work Completed /
 * Remaining Tasks / MUST NOT Do) is part of the contract OpenCode's
 * summarisation expects. Do not rewrite the body without updating downstream
 * consumers — the existing wording is byte-identical to the pre-extraction
 * version in src/services/compaction.ts.
 */
export function createCompactionPrompt(projectMemories: string[]): string {
  const memoriesSection =
    projectMemories.length > 0
      ? `
## Project Knowledge (from Supermemory)
The following project-specific knowledge should be preserved and referenced in the summary:
${projectMemories.map((m) => `- ${m}`).join("\n")}
`
      : "";

  return `[COMPACTION CONTEXT INJECTION]

When summarizing this session, you MUST include the following sections in your summary:

## 1. User Requests (As-Is)
- List all original user requests exactly as they were stated
- Preserve the user's exact wording and intent

## 2. Final Goal
- What the user ultimately wanted to achieve
- The end result or deliverable expected

## 3. Work Completed
- What has been done so far
- Files created/modified
- Features implemented
- Problems solved

## 4. Remaining Tasks
- What still needs to be done
- Pending items from the original request
- Follow-up tasks identified during the work

## 5. MUST NOT Do (Critical Constraints)
- Things that were explicitly forbidden
- Approaches that failed and should not be retried
- User's explicit restrictions or preferences
- Anti-patterns identified during the session
${memoriesSection}
This context is critical for maintaining continuity after compaction.
`;
}
