/** Hold the window open until the renderer commits its pending workspace save. */
export const createShutdownCoordinator = (
  requestFlush: (requestId: number) => void,
  close: () => void,
  onFailure: (message: string) => void,
) => {
  let ready = false,
    pending: number | undefined,
    sequence = 0,
    committed = false;
  return {
    setReady(value: boolean) {
      ready = value;
    },
    shouldPreventClose() {
      if (committed || !ready) return false;
      if (pending === undefined) {
        pending = ++sequence;
        requestFlush(pending);
      }
      return true;
    },
    complete(requestId: number, ok: boolean, message?: string) {
      if (requestId !== pending) return;
      pending = undefined;
      if (ok) {
        committed = true;
        close();
      } else onFailure(message ?? 'Unable to save the workspace');
    },
  };
};
