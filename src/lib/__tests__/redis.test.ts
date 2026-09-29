jest.mock("redis", () => ({
  createClient: jest.fn(),
}));

jest.mock("@/server/config", () => ({
  serverConfig: { redis: { url: "redis://localhost" } },
}));

import { createClient } from "redis";
import { getRedisClient, getRedisMetrics, withRedis } from "../redis";

describe("Redis outage handling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("records operation failures with a low-cardinality operation label", async () => {
    const redisClient = {
      isOpen: false,
      on: jest.fn().mockReturnThis(),
      connect: jest.fn().mockResolvedValue(undefined),
      incr: jest.fn().mockRejectedValue(new Error("connection refused")),
    };
    (createClient as jest.Mock).mockReturnValue(redisClient);

    await expect(withRedis("otp_rate_limit", (client) => client.incr("key"))).rejects.toMatchObject(
      { name: "RedisUnavailableError", operation: "otp_rate_limit" }
    );

    const metrics = getRedisMetrics();
    expect(metrics.failuresByOperation.otp_rate_limit).toBeGreaterThanOrEqual(1);
    expect(metrics.lastFailureAt).not.toBeNull();
  });

  it("clears a failed initial connection so a later call can retry", async () => {
    const failedClient = {
      isOpen: false,
      on: jest.fn().mockReturnThis(),
      connect: jest.fn().mockRejectedValue(new Error("connection refused")),
    };
    const connectedClient = {
      isOpen: true,
      on: jest.fn().mockReturnThis(),
      connect: jest.fn().mockResolvedValue(undefined),
    };
    (createClient as jest.Mock)
      .mockReturnValueOnce(failedClient)
      .mockReturnValueOnce(connectedClient);

    await expect(getRedisClient()).rejects.toMatchObject({ name: "RedisUnavailableError" });
    await expect(getRedisClient()).resolves.toMatchObject({ isOpen: true });
  });
});
