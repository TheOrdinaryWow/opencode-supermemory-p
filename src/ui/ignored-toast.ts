/**
 * One-shot startup toast shown when the plugin is disabled because the
 * project contains a `.supermemoryignore` file. The toast surfaces the
 * disable in OpenCode's TUI so users immediately understand why memory
 * features stopped working in this repo.
 *
 * Pattern borrowed from oh-my-openagent's auto-update-checker — the toast
 * is emitted on the first event after init (TUI is not ready during the
 * plugin factory call), and a closed-over `shown` flag prevents it from
 * firing repeatedly across every subsequent event.
 */

export const IGNORED_TOAST_MESSAGE = "Supermemory is disabled because .supermemoryignore file is present in the project.";

/** Minimal slice of OpenCode's TUI client surface that the toast needs. */
export interface ToastClient {
  showToast: (params: { body: { title: string; message: string; variant: string; duration: number } }) => Promise<unknown>;
}

export interface IgnoredToastOptions {
  /** OpenCode TUI client. When undefined (e.g. headless contexts), the emitter becomes a no-op. */
  client: ToastClient | undefined;
  /** Plugin version baked into the toast title. */
  version: string;
  /** Logger used to swallow showToast failures without breaking the event hook. */
  log: (message: string, data?: unknown) => void;
}

/**
 * Build a one-shot emitter that posts the disabled-by-ignore toast on
 * its first invocation and returns immediately on every subsequent call.
 *
 * The returned function never throws — `showToast` errors are logged
 * and swallowed.
 */
export function createIgnoredToastEmitter({ client, version, log }: IgnoredToastOptions): () => Promise<void> {
  let shown = false;
  return async function emitOnce(): Promise<void> {
    if (shown) return;
    if (!client?.showToast) return;
    shown = true;
    try {
      await client.showToast({
        body: {
          title: `opencode-supermemory-p ${version}`,
          message: IGNORED_TOAST_MESSAGE,
          variant: "info",
          duration: 5000,
        },
      });
    } catch (err) {
      log("failed to show .supermemoryignore toast", { error: String(err) });
    }
  };
}
