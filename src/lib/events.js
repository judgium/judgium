import { config } from '../config.js';

const HEARTBEAT_MS = 25_000;

/**
 * In-process Server-Sent Events hub, keyed by topic (one topic per
 * competition). SSE is used instead of WebSockets because Azure App Service
 * proxies it without extra configuration and it survives the aggressive
 * mobile-network disconnects you get in a demo room - the browser reconnects
 * on its own and we replay current state on connect.
 *
 * Subscribers are per-instance. If the plan is scaled out, either pin the app
 * to one instance for the judging session or put ARR affinity in front of it;
 * the client also polls as a fallback so a missed broadcast self-heals.
 */
class EventHub {
  constructor({ maxClients = config.capacity.maxLiveClients } = {}) {
    this.maxClients = maxClients;
    this.topics = new Map(); // topic -> Set<client>
    this.clientCount = 0;
    this.totalConnections = 0;
    this.rejectedConnections = 0;
    this.heartbeat = setInterval(() => this.#tick(), HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  get stats() {
    return {
      clients: this.clientCount,
      maxClients: this.maxClients,
      topics: this.topics.size,
      totalConnections: this.totalConnections,
      rejectedConnections: this.rejectedConnections,
    };
  }

  atCapacity() {
    return this.clientCount >= this.maxClients;
  }

  /**
   * Attach an Express response as an SSE stream.
   * Returns the client handle, or null when the instance is at capacity.
   */
  subscribe(topic, req, res) {
    if (this.atCapacity()) {
      this.rejectedConnections++;
      return null;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Defeat proxy response buffering (nginx and the App Service front end).
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    // Tell the browser how long to wait before reconnecting.
    res.write('retry: 4000\n\n');

    const client = { topic, res, closed: false };
    let set = this.topics.get(topic);
    if (!set) {
      set = new Set();
      this.topics.set(topic, set);
    }
    set.add(client);
    this.clientCount++;
    this.totalConnections++;

    const cleanup = () => this.#remove(client);
    req.on('close', cleanup);
    req.on('error', cleanup);
    res.on('error', cleanup);

    return client;
  }

  sendTo(client, event, data) {
    if (!client || client.closed) return false;
    try {
      client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      return true;
    } catch {
      this.#remove(client);
      return false;
    }
  }

  publish(topic, event, data) {
    const set = this.topics.get(topic);
    if (!set || set.size === 0) return 0;
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    let delivered = 0;
    for (const client of [...set]) {
      try {
        client.res.write(frame);
        delivered++;
      } catch {
        this.#remove(client);
      }
    }
    return delivered;
  }

  subscriberCount(topic) {
    return this.topics.get(topic)?.size ?? 0;
  }

  #tick() {
    for (const set of this.topics.values()) {
      for (const client of [...set]) {
        try {
          client.res.write(': ping\n\n');
        } catch {
          this.#remove(client);
        }
      }
    }
  }

  #remove(client) {
    if (client.closed) return;
    client.closed = true;
    const set = this.topics.get(client.topic);
    if (set) {
      set.delete(client);
      if (set.size === 0) this.topics.delete(client.topic);
    }
    this.clientCount = Math.max(0, this.clientCount - 1);
    try {
      client.res.end();
    } catch {
      /* already gone */
    }
  }

  /**
   * Drop every subscriber to one topic. Used when a competition is deleted:
   * its viewers are holding an open stream to rows that no longer exist, and
   * ending it makes the browser reconnect and get an honest 404 instead of
   * sitting on a board that will never update again.
   */
  closeTopic(topic) {
    const set = this.topics.get(topic);
    if (!set) return 0;
    const count = set.size;
    for (const client of [...set]) this.#remove(client);
    return count;
  }

  closeAll() {
    clearInterval(this.heartbeat);
    for (const set of [...this.topics.values()]) {
      for (const client of [...set]) this.#remove(client);
    }
  }
}

export const hub = new EventHub();

/**
 * Coalesces bursts of "something changed" into at most one callback per
 * throttle window per key. During a demo a dozen judges type at once; the
 * leaderboard only needs to be recomputed and pushed a few times a second.
 */
export function createThrottledNotifier(fn, waitMs = config.capacity.leaderboardThrottleMs) {
  const pending = new Map(); // key -> { timer, lastRun }

  return function notify(key) {
    const state = pending.get(key) || { timer: null, lastRun: 0 };
    if (state.timer) return; // a run is already scheduled
    const elapsed = Date.now() - state.lastRun;
    const delay = elapsed >= waitMs ? 0 : waitMs - elapsed;

    state.timer = setTimeout(() => {
      state.timer = null;
      state.lastRun = Date.now();
      try {
        fn(key);
      } catch (err) {
        console.error('[events] notifier failed for', key, err);
      }
      // Forget idle keys so an all-day process does not accumulate them.
      if (!state.timer) {
        setTimeout(() => {
          const cur = pending.get(key);
          if (cur && !cur.timer && Date.now() - cur.lastRun >= waitMs * 10) pending.delete(key);
        }, waitMs * 10).unref?.();
      }
    }, delay);
    state.timer.unref?.();
    pending.set(key, state);
  };
}
