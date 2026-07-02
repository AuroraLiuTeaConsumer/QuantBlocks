import Redis from "ioredis";

export type RedisPublisher = { publish(channel: string, message: string): Promise<number> };

const noopPublisher: RedisPublisher = {
  publish(_channel: string, _message: string): Promise<number> {
    return Promise.resolve(0);
  },
};

let _publisher: RedisPublisher | null = null;

export function getRedisPublisher(): RedisPublisher {
  if (_publisher) return _publisher;

  const url = process.env.REDIS_URL;
  if (!url) {
    _publisher = noopPublisher;
    return _publisher;
  }

  let client: Redis;
  try {
    client = new Redis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
  } catch (err) {
    console.warn("[redis] failed to create publisher, falling back to no-op: " + (err instanceof Error ? err.message : String(err)));
    _publisher = noopPublisher;
    return _publisher;
  }

  client.on("error", (err: Error) => {
    console.warn("[redis] publisher error: " + err.message);
  });

  _publisher = client;
  return _publisher;
}

export function createRedisSubscriber(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("[redis] REDIS_URL is not set — cannot create subscriber");
  }

  const client = new Redis(url);

  client.on("error", (err: Error) => {
    console.warn("[redis] subscriber error: " + err.message);
  });

  return client;
}

export const WORKER_HEARTBEAT_KEY = "paper-worker:heartbeat";
const WORKER_HEARTBEAT_TTL_SEC = 30;

/** Written by the paper-worker process on startup and every 10 s. */
export async function setWorkerHeartbeat(): Promise<void> {
  const client = getRedisPublisher() as Partial<import("ioredis").default>;
  if (typeof client.set !== "function") return;
  await (client.set as Function)(WORKER_HEARTBEAT_KEY, "1", "EX", WORKER_HEARTBEAT_TTL_SEC).catch(() => undefined);
}

/** Deleted by the paper-worker on graceful shutdown. */
export async function clearWorkerHeartbeat(): Promise<void> {
  const client = getRedisPublisher() as Partial<import("ioredis").default>;
  if (typeof client.del !== "function") return;
  await (client.del as Function)(WORKER_HEARTBEAT_KEY).catch(() => undefined);
}

/**
 * Returns true only when Redis is reachable AND the paper-worker heartbeat key
 * exists. Use this (not isRedisAvailable) to decide whether to create a worker-
 * mode session — a live Redis with no running worker would silently stall.
 */
export async function isWorkerAlive(timeoutMs = 500): Promise<boolean> {
  if (!(await isRedisAvailable(timeoutMs))) return false;
  const client = getRedisPublisher() as Partial<import("ioredis").default>;
  if (typeof client.get !== "function") return false;
  try {
    return (await (client.get as Function)(WORKER_HEARTBEAT_KEY)) !== null;
  } catch {
    return false;
  }
}

/**
 * Returns true when Redis is reachable within `timeoutMs`.
 *
 * Fast-returns false when REDIS_URL is unset or the publisher is the no-op
 * fallback (which has no ping method). Used at session-start time to decide
 * whether to create a "worker" or "poll" mode session.
 */
export async function isRedisAvailable(timeoutMs = 500): Promise<boolean> {
  if (!process.env.REDIS_URL) return false;
  const pub = getRedisPublisher();
  // The no-op publisher does not implement ping; the real ioredis client does.
  const client = pub as Partial<import("ioredis").default>;
  if (typeof client.ping !== "function") return false;

  // The publisher is created with enableOfflineQueue:false, so ping() rejects
  // *immediately* (not via timeout) while the socket is still in its initial
  // connect handshake — e.g. when the very first paper session is started right
  // after the server process boots. That would misclassify an available Redis as
  // "down" and create a "poll"-mode session. Wait briefly for the "ready" event
  // when (and only when) the connection is still being established. A persistently
  // down Redis settles into "reconnecting"/"close", so this does not tax the
  // configured-but-offline case with the full timeout on every start.
  if (
    (client.status === "connecting" || client.status === "connect") &&
    typeof client.once === "function"
  ) {
    const becameReady = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        client.removeListener?.("ready", onReady);
        resolve(false);
      }, timeoutMs);
      function onReady(): void {
        clearTimeout(timer);
        resolve(true);
      }
      client.once!("ready", onReady);
    });
    if (!becameReady) return false;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pong = await Promise.race([
      client.ping(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("redis ping timeout")), timeoutMs);
      }),
    ]);
    return pong === "PONG";
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
