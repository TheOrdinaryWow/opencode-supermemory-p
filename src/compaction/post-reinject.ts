import type { SupermemoryConfig } from "@/config/schema";
import { registerSessionCleaner } from "@/session/reaper";

export interface EventSessionCompacted {
  event: {
    properties?: {
      sessionID?: string;
    };
  };
}

export const pendingReinjectSessions = new Set<string>();

registerSessionCleaner((sessionID) => pendingReinjectSessions.delete(sessionID));

export function handleSessionCompacted(input: EventSessionCompacted, config: SupermemoryConfig): void {
  if (config.postCompactionReinject !== true) return;

  const sessionID = input.event.properties?.sessionID;
  if (!sessionID) return;

  pendingReinjectSessions.add(sessionID);
}
