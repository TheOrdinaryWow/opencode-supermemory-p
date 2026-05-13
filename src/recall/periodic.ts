export function shouldPeriodicReinject(sessionID: string, reinjectEveryN: number, counter: Map<string, number>): boolean {
  const completedMessages = counter.get(sessionID);
  return reinjectEveryN > 0 && completedMessages !== undefined && completedMessages > 0 && completedMessages % reinjectEveryN === 0;
}
