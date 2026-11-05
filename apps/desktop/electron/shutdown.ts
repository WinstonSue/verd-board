/** Hold the window open until the renderer commits its pending workspace save. */
export const createShutdownCoordinator = (
  requestFlush: (requestId: number) => void,
  close: () => void,
  onFailure: (message: string) => void,
  timeoutMs?: number,
) => {
  let ready = false,
    pending: number | undefined,
    sequence = 0,
    committed = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const complete = (requestId: number, ok: boolean, message?: string) => {
    if (requestId !== pending) return;
    clearTimeout(timeout);
    pending = undefined;
    if (ok) {
      committed = true;
      close();
    } else onFailure(message ?? 'Unable to save the workspace');
  };
  return {
    setReady(value: boolean) {
      ready = value;
    },
    shouldPreventClose() {
      if (committed || !ready) return false;
      if (pending === undefined) {
        const requestId = ++sequence;
        pending = requestId;
        if (timeoutMs !== undefined) {
          timeout = setTimeout(
            () =>
              complete(requestId, false, '等待工作区保存确认超时，请重试。'),
            timeoutMs,
          ).unref();
        }
        requestFlush(requestId);
      }
      return true;
    },
    complete,
  };
};
