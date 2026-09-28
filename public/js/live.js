/**
 * Live leaderboard subscription.
 *
 * Prefers Server-Sent Events and silently degrades to polling when the server
 * is at its live-client ceiling, when a proxy eats the stream, or when the
 * browser has no EventSource. Either way the caller just receives boards.
 */
export function subscribeBoard({ streamUrl, pollUrl, onBoard, onStatus, pollMs = 5000 }) {
  let source = null;
  let pollTimer = null;
  let stopped = false;
  let lastRev = -1;
  let sseFailures = 0;

  const status = (state) => onStatus?.(state);

  const deliver = (board) => {
    if (!board || board.rev === lastRev) return;
    lastRev = board.rev;
    onBoard(board);
  };

  async function pollOnce() {
    try {
      const res = await fetch(pollUrl, { headers: { accept: 'application/json' }, credentials: 'same-origin' });
      if (res.status === 304) return;
      if (!res.ok) throw new Error(String(res.status));
      deliver(await res.json());
      status('polling');
    } catch {
      status('offline');
    }
  }

  function startPolling() {
    if (stopped || pollTimer) return;
    status('polling');
    pollOnce();
    pollTimer = setInterval(pollOnce, pollMs);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function startStream() {
    if (stopped || typeof EventSource === 'undefined') return startPolling();

    source = new EventSource(streamUrl, { withCredentials: true });

    source.addEventListener('open', () => {
      sseFailures = 0;
      stopPolling();
      status('live');
    });

    source.addEventListener('board', (event) => {
      try {
        deliver(JSON.parse(event.data));
        status('live');
      } catch {
        /* ignore a truncated frame; the next one supersedes it */
      }
    });

    source.addEventListener('error', () => {
      // EventSource reconnects on its own, but if it keeps failing the server
      // is probably at capacity or a proxy is buffering - poll instead.
      status('reconnecting');
      sseFailures++;
      if (sseFailures >= 3) {
        source.close();
        source = null;
        startPolling();
      } else {
        startPolling();
      }
    });
  }

  // Pause the stream while the tab is hidden so a leaderboard left open on a
  // laptop overnight does not hold a connection for nothing.
  const onVisibility = () => {
    if (document.hidden) {
      source?.close();
      source = null;
      stopPolling();
    } else if (!stopped) {
      startStream();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  startStream();

  return {
    refresh: pollOnce,
    stop() {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisibility);
      source?.close();
      source = null;
      stopPolling();
    },
  };
}
