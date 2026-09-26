// ─── User ─────────────────────────────────────────────────────────────────────
export interface User {
  id: string;
  phone: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  stellarPublicKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Gift ─────────────────────────────────────────────────────────────────────
export type GiftStatus =
  | "draft"
  | "pending_payment"
  | "funded"
  | "locked"
  | "unlocked"
  | "claimed"
  | "expired"
  | "cancelled";

export interface Gift {
  id: string;
  senderId: string;
  /** SHA-256 hex digest of the E.164 recipient phone number. Plaintext is never persisted. */
  recipientPhoneHash: string;
  recipientName: string;
  recipientEmail?: string;
  amountNgn: number;
  amountUsdc: string; // on-chain amount as string to preserve precision
  message?: string;
  mediaUrl?: string;
  unlockAt: Date;
  status: GiftStatus;
  contractId?: string; // Soroban escrow contract instance
  stellarTxHash?: string; // funding transaction hash
  claimTxHash?: string; // claim transaction hash
  createdAt: Date;
  updatedAt: Date;
}

// ─── Payment ──────────────────────────────────────────────────────────────────
export type PaymentProvider = "paystack" | "stripe";
export type PaymentStatus = "pending" | "success" | "failed" | "refunded";

export interface Payment {
  id: string;
  giftId: string;
  provider: PaymentProvider;
  providerReference: string;
  amountNgn: number;
  status: PaymentStatus;
  createdAt: Date;
}

// ─── Notification ─────────────────────────────────────────────────────────────
export type NotificationType =
  | "gift_received"
  | "gift_unlocked"
  | "gift_claimed"
  | "otp"
  | "new_device_login"
  | "suspicious_login_reported";

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  read: boolean;
  createdAt: Date;
}

// ─── Notification Preferences ─────────────────────────────────────────────────

/** Supported delivery channels for notifications. */
export type NotificationChannel = "sms" | "email" | "push";

/**
 * Notification categories.
 * - `security`  : Mandatory. Always delivered regardless of user preferences
 *                 (OTP codes, suspicious-login alerts, etc.).
 * - `lifecycle` : Transactional messages tied to gift lifecycle events.
 * - `marketing` : Promotional and engagement messages. Off by default.
 */
export type NotificationCategory = "security" | "lifecycle" | "marketing";

/** A single channel × category preference entry. */
export interface NotificationPreferenceEntry {
  channel: NotificationChannel;
  category: NotificationCategory;
  /** Whether the user has opted in to this channel + category combination. */
  enabled: boolean;
}

/**
 * Full notification preference set for a user.
 *
 * Note: `security` category entries are enforced as always-on by the
 * application layer and cannot be disabled by the user.
 */
export interface NotificationPreferences {
  userId: string;
  preferences: NotificationPreferenceEntry[];
  /** Timestamp of the most recent preference change for this user. */
  updatedAt: Date;
}

// ─── API Responses ────────────────────────────────────────────────────────────
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: string;
  code?: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ─── Stellar ──────────────────────────────────────────────────────────────────
export interface StellarAccount {
  publicKey: string;
  sequence: string;
  balances: StellarBalance[];
}

export interface StellarBalance {
  assetCode: string;
  assetIssuer?: string;
  balance: string;
}

export interface EscrowContractState {
  contractId: string;
  sender: string;
  recipient: string;
  amountUsdc: string;
  unlockTimestamp: number;
  claimed: boolean;
}
