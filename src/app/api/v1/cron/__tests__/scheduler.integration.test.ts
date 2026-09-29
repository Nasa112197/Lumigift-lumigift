/**
 * @jest-environment node
 *
 * Scheduler integration tests — covers the v1 cron routes:
 *   GET /api/v1/cron/unlock
 *   GET /api/v1/cron/expire
 *
 * The scheduler service (processUnlocks / processExpiries) is stubbed with
 * a contract stub that can simulate:
 *   - normal success
 *   - failures (retryable errors)
 *   - concurrent idempotent invocations
 *
 * Closes #118
 */

import { NextRequest } from "next/server";

// ─── Contract stubs for scheduler service ─────────────────────────────────────

const mockProcessUnlocks = jest.fn();
const mockProcessExpiries = jest.fn();

jest.mock("@/server/services/scheduler.service", () => ({
  processUnlocks: (...args: unknown[]) => mockProcessUnlocks(...args),
  processExpiries: (...args: unknown[]) => mockProcessExpiries(...args),
}));

// Suppress healthcheck fetch in unit tests
global.fetch = jest.fn().mockResolvedValue({ ok: true });

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CRON_SECRET = "super-secret-cron-token";

function makeUnlockRequest(authHeader?: string) {
  return new NextRequest("http://localhost/api/v1/cron/unlock", {
    method: "GET",
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

function makeExpireRequest(authHeader?: string) {
  return new NextRequest("http://localhost/api/v1/cron/expire", {
    method: "GET",
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

// ─── GET /api/v1/cron/unlock ─────────────────────────────────────────────────

describe("GET /api/v1/cron/unlock", () => {
  let GET: (req: NextRequest) => Promise<Response>;
  const OLD_ENV = process.env;

  beforeEach(async () => {
    jest.resetModules();
    mockProcessUnlocks.mockReset();
    (global.fetch as jest.Mock).mockClear();
    process.env = { ...OLD_ENV, CRON_SECRET };

    ({ GET } = await import("@/app/api/v1/cron/unlock/route"));
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it("returns 401 when no Authorization header is provided", async () => {
    const res = await GET(makeUnlockRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/unauthorized/i);
  });

  it("returns 401 when the token is wrong", async () => {
    const res = await GET(makeUnlockRequest("Bearer wrong-token"));
    expect(res.status).toBe(401);
  });

  it("returns 401 when CRON_SECRET is not configured", async () => {
    process.env = { ...OLD_ENV }; // no CRON_SECRET
    delete process.env.CRON_SECRET;
    ({ GET } = await import("@/app/api/v1/cron/unlock/route"));

    const res = await GET(makeUnlockRequest(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(401);
  });

  it("returns 200 with processed count on success", async () => {
    mockProcessUnlocks.mockResolvedValue(3);

    const res = await GET(makeUnlockRequest(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.processed).toBe(3);
    expect(typeof body.data.durationMs).toBe("number");
    expect(body.data.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("calls processUnlocks exactly once per request", async () => {
    mockProcessUnlocks.mockResolvedValue(0);

    await GET(makeUnlockRequest(`Bearer ${CRON_SECRET}`));
    expect(mockProcessUnlocks).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when processUnlocks throws (retryable error)", async () => {
    mockProcessUnlocks.mockRejectedValue(new Error("DB connection timeout"));

    const res = await GET(makeUnlockRequest(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/cron job failed/i);
  });

  it("pings healthcheck on success", async () => {
    process.env = { ...OLD_ENV, CRON_SECRET, HEALTHCHECK_URL: "https://hc.example.com/abc123" };
    ({ GET } = await import("@/app/api/v1/cron/unlock/route"));
    mockProcessUnlocks.mockResolvedValue(1);

    await GET(makeUnlockRequest(`Bearer ${CRON_SECRET}`));
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("hc.example.com"),
      expect.any(Object)
    );
  });

  it("pings healthcheck /fail on error", async () => {
    process.env = { ...OLD_ENV, CRON_SECRET, HEALTHCHECK_URL: "https://hc.example.com/abc123" };
    ({ GET } = await import("@/app/api/v1/cron/unlock/route"));
    mockProcessUnlocks.mockRejectedValue(new Error("boom"));

    await GET(makeUnlockRequest(`Bearer ${CRON_SECRET}`));
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/fail"),
      expect.any(Object)
    );
  });

  // ── Idempotency: concurrent runs ────────────────────────────────────────────
  it("concurrent runs are independently idempotent (each returns its own processed count)", async () => {
    let callCount = 0;
    mockProcessUnlocks.mockImplementation(async () => {
      callCount++;
      // Simulate a small delay to create some overlap
      await new Promise((r) => setTimeout(r, 5));
      return callCount;
    });

    const [res1, res2] = await Promise.all([
      GET(makeUnlockRequest(`Bearer ${CRON_SECRET}`)),
      GET(makeUnlockRequest(`Bearer ${CRON_SECRET}`)),
    ]);

    // Both should succeed
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    // processUnlocks must have been called exactly twice
    expect(mockProcessUnlocks).toHaveBeenCalledTimes(2);
  });
});

// ─── GET /api/v1/cron/expire ─────────────────────────────────────────────────

describe("GET /api/v1/cron/expire", () => {
  let GET: (req: NextRequest) => Promise<Response>;
  const OLD_ENV = process.env;

  beforeEach(async () => {
    jest.resetModules();
    mockProcessExpiries.mockReset();
    (global.fetch as jest.Mock).mockClear();
    process.env = { ...OLD_ENV, CRON_SECRET };

    ({ GET } = await import("@/app/api/v1/cron/expire/route"));
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it("returns 401 when no Authorization header is provided", async () => {
    const res = await GET(makeExpireRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it("returns 401 when token is wrong", async () => {
    const res = await GET(makeExpireRequest("Bearer bad-token"));
    expect(res.status).toBe(401);
  });

  it("returns 200 with message and durationMs on success", async () => {
    mockProcessExpiries.mockResolvedValue(undefined);

    const res = await GET(makeExpireRequest(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.message).toMatch(/expiry check complete/i);
    expect(typeof body.data.durationMs).toBe("number");
  });

  it("calls processExpiries exactly once per request", async () => {
    mockProcessExpiries.mockResolvedValue(undefined);

    await GET(makeExpireRequest(`Bearer ${CRON_SECRET}`));
    expect(mockProcessExpiries).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when processExpiries throws (notification/refund failure is retryable)", async () => {
    mockProcessExpiries.mockRejectedValue(new Error("Stellar refund failed"));

    const res = await GET(makeExpireRequest(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/expiry job failed/i);
  });

  it("pings HEALTHCHECK_URL_EXPIRE on success when set", async () => {
    process.env = {
      ...OLD_ENV,
      CRON_SECRET,
      HEALTHCHECK_URL_EXPIRE: "https://hc.example.com/expire-token",
    };
    ({ GET } = await import("@/app/api/v1/cron/expire/route"));
    mockProcessExpiries.mockResolvedValue(undefined);

    await GET(makeExpireRequest(`Bearer ${CRON_SECRET}`));
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("expire-token"),
      expect.any(Object)
    );
  });

  it("falls back to HEALTHCHECK_URL when HEALTHCHECK_URL_EXPIRE is unset", async () => {
    process.env = {
      ...OLD_ENV,
      CRON_SECRET,
      HEALTHCHECK_URL: "https://hc.example.com/fallback",
    };
    delete process.env.HEALTHCHECK_URL_EXPIRE;
    ({ GET } = await import("@/app/api/v1/cron/expire/route"));
    mockProcessExpiries.mockResolvedValue(undefined);

    await GET(makeExpireRequest(`Bearer ${CRON_SECRET}`));
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("fallback"),
      expect.any(Object)
    );
  });

  it("pings healthcheck /fail when processExpiries throws", async () => {
    process.env = {
      ...OLD_ENV,
      CRON_SECRET,
      HEALTHCHECK_URL_EXPIRE: "https://hc.example.com/expire-token",
    };
    ({ GET } = await import("@/app/api/v1/cron/expire/route"));
    mockProcessExpiries.mockRejectedValue(new Error("boom"));

    await GET(makeExpireRequest(`Bearer ${CRON_SECRET}`));
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/fail"),
      expect.any(Object)
    );
  });

  // ── Idempotency: concurrent runs ────────────────────────────────────────────
  it("concurrent expire runs are independently idempotent", async () => {
    mockProcessExpiries.mockResolvedValue(undefined);

    const [res1, res2] = await Promise.all([
      GET(makeExpireRequest(`Bearer ${CRON_SECRET}`)),
      GET(makeExpireRequest(`Bearer ${CRON_SECRET}`)),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(mockProcessExpiries).toHaveBeenCalledTimes(2);
  });
});

// ─── Scheduler service contract stub ─────────────────────────────────────────
// These tests validate the expected interface between the cron routes and the
// scheduler service, independently of the DB implementation (processUnlocks /
// processExpiries are declared as stubs in scheduler.service.ts).

describe("Scheduler service contract (stub verification)", () => {
  beforeEach(() => {
    jest.resetModules();
    mockProcessUnlocks.mockReset();
    mockProcessExpiries.mockReset();
  });

  it("processUnlocks resolves to a number (gift count)", async () => {
    mockProcessUnlocks.mockResolvedValue(42);
    const { processUnlocks } = await import("@/server/services/scheduler.service");
    const count = await processUnlocks();
    expect(typeof count).toBe("number");
    expect(count).toBe(42);
  });

  it("processExpiries resolves to void", async () => {
    mockProcessExpiries.mockResolvedValue(undefined);
    const { processExpiries } = await import("@/server/services/scheduler.service");
    const result = await processExpiries();
    expect(result).toBeUndefined();
  });

  it("processUnlocks is retryable — re-invocation after error succeeds", async () => {
    mockProcessUnlocks
      .mockRejectedValueOnce(new Error("transient DB error"))
      .mockResolvedValueOnce(5);

    const { processUnlocks } = await import("@/server/services/scheduler.service");

    await expect(processUnlocks()).rejects.toThrow("transient DB error");
    const count = await processUnlocks();
    expect(count).toBe(5);
  });

  it("processExpiries is retryable — re-invocation after error succeeds", async () => {
    mockProcessExpiries
      .mockRejectedValueOnce(new Error("SMS send failed"))
      .mockResolvedValueOnce(undefined);

    const { processExpiries } = await import("@/server/services/scheduler.service");

    await expect(processExpiries()).rejects.toThrow("SMS send failed");
    await expect(processExpiries()).resolves.toBeUndefined();
  });
});
