import type { NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "../validate";

jest.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

function makeRequest(body: string): NextRequest {
  return {
    json: async () => JSON.parse(body),
  } as NextRequest;
}

describe("validateBody", () => {
  const schema = z.strictObject({
    phone: z.string().refine(() => false, "Invalid phone"),
  });

  it("returns a consistent 400 response for malformed JSON", async () => {
    const result = await validateBody(makeRequest("{"), schema);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.response.status).toBe(400);
      expect(await result.response.json()).toMatchObject({ code: "INVALID_PAYLOAD" });
    }
  });

  it("rejects unknown fields without echoing submitted values", async () => {
    const result = await validateBody(
      makeRequest(JSON.stringify({ phone: "sensitive-phone", extra: "sensitive-value" })),
      schema
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      const response = await result.response.json();
      expect(result.response.status).toBe(400);
      expect(response.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(response)).not.toContain("sensitive-value");
    }
  });

  it("does not include invalid input values in validation errors", async () => {
    const result = await validateBody(
      makeRequest(JSON.stringify({ phone: "private-phone-number" })),
      schema
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(await result.response.json())).not.toContain("private-phone-number");
    }
  });
});
