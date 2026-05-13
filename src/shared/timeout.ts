export function withTimeout<T>(promise: Promise<T>, ms: number, label?: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout after ${ms}ms${label ? ` (${label})` : ""}`));
      }, ms);

      promise.finally(() => clearTimeout(timer));
    }),
  ]);
}
