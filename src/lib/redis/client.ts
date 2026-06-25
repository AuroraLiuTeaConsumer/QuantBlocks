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
