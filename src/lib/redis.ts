import { createClient } from "redis";
import { serverConfig } from "@/server/config";

let client: ReturnType<typeof createClient> | null = null;
let connecting: Promise<ReturnType<typeof createClient>> | null = null;

export class RedisUnavailableError extends Error {
  readonly operation: string;

  constructor(operation: string, options?: ErrorOptions) {
    super("Redis is unavailable", options);
    this.name = "RedisUnavailableError";
    this.operation = operation;
  }
}

export interface RedisMetrics {
  failuresTotal: number;
  failuresByOperation: Record<string, number>;
  lastFailureAt: string | null;
}

const redisMetrics: RedisMetrics = {
  failuresTotal: 0,
  failuresByOperation: {},
  lastFailureAt: null,
};

function recordFailure(operation: string): void {
  redisMetrics.failuresTotal++;
  redisMetrics.failuresByOperation[operation] =
    (redisMetrics.failuresByOperation[operation] ?? 0) + 1;
  redisMetrics.lastFailureAt = new Date().toISOString();
}

function monitorCommands<T extends object>(redisClient: T): T {
  return new Proxy(redisClient, {
    get(target, property) {
      const member = Reflect.get(target, property, target) as unknown;
      if (typeof member !== "function") return member;

      return (...args: unknown[]) => {
        const result = member.apply(target, args) as unknown;
        if (
          result &&
          typeof result === "object" &&
          "then" in result &&
          typeof result.then === "function"
        ) {
          return Promise.resolve(result).catch((err: unknown) => {
            recordFailure("command");
            throw new RedisUnavailableError("command", { cause: err });
          });
        }
        return result;
      };
    },
  });
}

export function getRedisMetrics(): RedisMetrics {
  return {
    ...redisMetrics,
    failuresByOperation: { ...redisMetrics.failuresByOperation },
  };
}

/**
 * Returns a connected Redis client, creating and connecting one on first call.
 * Subsequent calls return the same singleton instance.
 *
 * @returns A connected `redis` client instance.
 * @throws Will throw if the initial connection to Redis fails.
 */
export async function getRedisClient(): Promise<ReturnType<typeof createClient>> {
  if (client?.isOpen) return client;
  if (connecting) return connecting;

  const newClient = createClient({ url: serverConfig.redis.url });
  const monitoredClient = monitorCommands(newClient);
  let connectionErrorRecorded = false;
  newClient.on("error", (err: Error) => {
    connectionErrorRecorded = true;
    recordFailure("client");
    console.error("[Redis]", err.message);
  });
  client = monitoredClient;

  connecting = newClient
    .connect()
    .then(() => monitoredClient)
    .catch((err: unknown) => {
      if (client === monitoredClient) client = null;
      if (!connectionErrorRecorded) recordFailure("connection");
      throw new RedisUnavailableError("connection", { cause: err });
    })
    .finally(() => {
      connecting = null;
    });

  return connecting;
}

/** Executes a Redis operation and gives callers a stable outage error. */
export async function withRedis<T>(
  operation: string,
  action: (_redis: Awaited<ReturnType<typeof getRedisClient>>) => Promise<T>
): Promise<T> {
  try {
    return await action(await getRedisClient());
  } catch (err) {
    recordFailure(operation);
    throw new RedisUnavailableError(operation, { cause: err });
  }
}

/**
 * Named export of the raw redis client getter for services that import `redis` directly.
 * @deprecated Use `getRedisClient()` instead.
 */
export const redis = {
  get: async (key: string) => withRedis("event_indexer_cursor", (client) => client.get(key)),
  set: async (key: string, value: string) =>
    withRedis("event_indexer_cursor", (redis) => redis.set(key, value)),
  setEx: async (key: string, ttl: number, value: string) =>
    withRedis("other", (redis) => redis.setEx(key, ttl, value)),
  del: async (key: string) => withRedis("other", (redis) => redis.del(key)),
  incr: async (key: string) => withRedis("other", (redis) => redis.incr(key)),
  expire: async (key: string, ttl: number) => withRedis("other", (redis) => redis.expire(key, ttl)),
  ttl: async (key: string) => withRedis("other", (redis) => redis.ttl(key)),
};
