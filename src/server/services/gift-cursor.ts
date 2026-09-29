import { createHmac, timingSafeEqual } from "crypto";
import { serverConfig } from "@/server/config";

export interface GiftCursorPosition {
  snapshotAt: string;
  createdAt: string;
  id: string;
}

interface GiftCursorPayload extends GiftCursorPosition {
  version: 1;
  senderId: string;
}

function sign(payload: string): Buffer {
  return createHmac("sha256", serverConfig.auth.secret).update(payload).digest();
}

export function encodeGiftCursor(senderId: string, position: GiftCursorPosition): string {
  const payload: GiftCursorPayload = { version: 1, senderId, ...position };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(encodedPayload).toString("base64url");
  return `${encodedPayload}.${signature}`;
}

export function decodeGiftCursor(token: string, senderId: string): GiftCursorPosition | null {
  if (token.length > 2048) return null;

  const [encodedPayload, encodedSignature, ...extraParts] = token.split(".");
  if (!encodedPayload || !encodedSignature || extraParts.length > 0) return null;

  const actualSignature = Buffer.from(encodedSignature, "base64url");
  const expectedSignature = sign(encodedPayload);
  if (
    actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    ) as Partial<GiftCursorPayload> | null;
    if (
      !payload ||
      payload.version !== 1 ||
      payload.senderId !== senderId ||
      typeof payload.snapshotAt !== "string" ||
      typeof payload.createdAt !== "string" ||
      typeof payload.id !== "string" ||
      !payload.id
    ) {
      return null;
    }

    const snapshotAt = Date.parse(payload.snapshotAt);
    const createdAt = Date.parse(payload.createdAt);
    if (!Number.isFinite(snapshotAt) || !Number.isFinite(createdAt) || createdAt > snapshotAt) {
      return null;
    }

    return {
      snapshotAt: new Date(snapshotAt).toISOString(),
      createdAt: new Date(createdAt).toISOString(),
      id: payload.id,
    };
  } catch {
    return null;
  }
}
