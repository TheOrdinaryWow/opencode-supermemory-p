const LEADING_ISO_TIMESTAMP_PATTERN = /^\[?\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?Z?\]?\s*/;

const SYSTEM_REMINDER_BLOCK_PATTERN = /<system-reminder\b[^>]*>[\s\S]*?<\/system-reminder>/gi;
const SUPERMEMORY_CONTEXT_BLOCK_PATTERN = /<supermemory-context\b[^>]*>[\s\S]*?<\/supermemory-context>/gi;
const SUPERMEMORY_CONTAINERS_BLOCK_PATTERN = /<supermemory-containers\b[^>]*>[\s\S]*?<\/supermemory-containers>/gi;

const SENTINEL_LINE_PATTERN =
  /^(?:Conversation info \(untrusted metadata\):|Sender \(untrusted metadata\):|Thread starter \(untrusted, for context\):|Replied message \(untrusted, for context\):|Forwarded message context \(untrusted metadata\):|Chat history since last reply \(untrusted, for context\):)[ \t]*(?:\r?\n[ \t]*```json\r?\n[\s\S]*?\r?\n```[ \t]*)?(?:\r?\n)?/gim;

export function stripInboundMetadata(text: string): string {
  if (!text) return "";

  return text
    .replace(LEADING_ISO_TIMESTAMP_PATTERN, "")
    .replace(SYSTEM_REMINDER_BLOCK_PATTERN, "")
    .replace(SUPERMEMORY_CONTEXT_BLOCK_PATTERN, "")
    .replace(SUPERMEMORY_CONTAINERS_BLOCK_PATTERN, "")
    .replace(SENTINEL_LINE_PATTERN, "")
    .replace(LEADING_ISO_TIMESTAMP_PATTERN, "")
    .trim();
}
