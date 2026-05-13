export type MemoryScope = "user" | "project";

export type MemoryType = "project-config" | "architecture" | "error-solution" | "preference" | "learned-pattern" | "conversation";

/**
 * Provenance of a stored memory — where it came from. Lets downstream queries
 * filter ("only user preferences") and purge scripts target specific sources
 * ("delete all auto-captured assistant turns from session X") without text
 * matching. Stored in the memory's metadata under the `source` key.
 */
export type MemorySource =
  | "user" // user explicitly asked the agent to remember this
  | "assistant" // assistant turn captured incrementally
  | "summary" // session-end / pre-compaction / post-compaction summary
  | "tool" // emitted by the supermemory tool itself
  | "system-filtered"; // synthetic / filtered transcript residue (rare)

export type ConversationRole = "user" | "assistant" | "system" | "tool";

export type ConversationContentPart = { type: "text"; text: string } | { type: "image_url"; imageUrl: { url: string } };

export interface ConversationToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ConversationMessage {
  role: ConversationRole;
  content: string | ConversationContentPart[];
  name?: string;
  tool_calls?: ConversationToolCall[];
  tool_call_id?: string;
}

export interface ConversationIngestResponse {
  id: string;
  conversationId: string;
  status: string;
}
