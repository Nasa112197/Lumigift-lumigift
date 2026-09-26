jest.mock("next-auth", () => ({ getServerSession: jest.fn() }));
jest.mock("@/lib/auth", () => ({ authOptions: {} }));
jest.mock("@/lib/db", () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

jest.mock("next/server", () => {
  class MockNextResponse {
    status: number;
    body: unknown;

    constructor(body: unknown, status: number) {
      this.body = body;
      this.status = status;
    }

    static json(body: unknown, options: { status: number }) {
      return new MockNextResponse(body, options.status);
    }
  }

  return { NextResponse: MockNextResponse };
});

import { getServerSession } from "next-auth";
import pool from "@/lib/db";
import { requireAdmin } from "@/server/middleware/admin";

const mockedGetServerSession = jest.mocked(getServerSession);
const mockedQuery = jest.mocked(pool.query);

describe("requireAdmin", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("rejects a missing session with 401", async () => {
    mockedGetServerSession.mockResolvedValue(null);

    const response = await requireAdmin();

    expect(response).toMatchObject({
      status: 401,
      body: { success: false, error: "Unauthorized", code: "UNAUTHORIZED" },
    });
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("rejects a non-admin role with 403", async () => {
    mockedGetServerSession.mockResolvedValue({ user: { id: "user-1" } } as never);
    mockedQuery.mockResolvedValue({ rows: [{ role: "user" }] } as never);

    const response = await requireAdmin();

    expect(response).toMatchObject({
      status: 403,
      body: { success: false, error: "Forbidden", code: "FORBIDDEN" },
    });
    expect(mockedQuery).toHaveBeenCalledWith("SELECT role FROM users WHERE id = $1", ["user-1"]);
  });

  it("returns the user ID for an explicit admin role", async () => {
    mockedGetServerSession.mockResolvedValue({ user: { id: "admin-1" } } as never);
    mockedQuery.mockResolvedValue({ rows: [{ role: "admin" }] } as never);

    await expect(requireAdmin()).resolves.toEqual({ userId: "admin-1" });
  });
});
