jest.mock("@/server/config", () => ({
  serverConfig: { auth: { secret: "test-secret-with-at-least-32-characters" } },
}));

import { decodeGiftCursor, encodeGiftCursor } from "../gift-cursor";

const position = {
  snapshotAt: "2026-01-03T00:00:00.000Z",
  createdAt: "2026-01-02T00:00:00.000Z",
  id: "gift-123",
};

describe("gift cursor tokens", () => {
  it("round-trips a valid position for its sender", () => {
    const token = encodeGiftCursor("sender-1", position);

    expect(decodeGiftCursor(token, "sender-1")).toEqual(position);
  });

  it("rejects a tampered token", () => {
    const [payload, signature] = encodeGiftCursor("sender-1", position).split(".");
    const tamperedPayload = `${payload[0] === "A" ? "B" : "A"}${payload.slice(1)}`;

    expect(decodeGiftCursor(`${tamperedPayload}.${signature}`, "sender-1")).toBeNull();
  });

  it("rejects a cursor issued for a different sender", () => {
    const token = encodeGiftCursor("sender-1", position);

    expect(decodeGiftCursor(token, "sender-2")).toBeNull();
  });

  it("rejects malformed token structure and invalid dates", () => {
    expect(decodeGiftCursor("not-a-cursor", "sender-1")).toBeNull();
    const token = encodeGiftCursor("sender-1", {
      ...position,
      createdAt: "2026-01-04T00:00:00.000Z",
    });

    expect(decodeGiftCursor(token, "sender-1")).toBeNull();
  });
});
