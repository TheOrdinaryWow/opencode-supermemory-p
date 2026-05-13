import type { SupermemoryConfig } from "@/config/schema";

export interface EventSessionCompacted {
  event: {
    properties?: {
      sessionID?: string;
    };
  };
}

export const pendingReinjectSessions = new Set<string>();

export function handleSessionCompacted(input: EventSessionCompacted, config: SupermemoryConfig): void {
  if (config.postCompactionReinject !== true) return;

  const sessionID = input.event.properties?.sessionID;
  if (!sessionID) return;

  pendingReinjectSessions.add(sessionID);
}
