"use client";

import { useState, useId } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useCsrf } from "@/hooks/useCsrf";
import styles from "./page.module.css";

type Step = "phone" | "otp";

/**
 * Validates that a callbackUrl is safe (same origin, relative path only).
 * Prevents open-redirect attacks via crafted callbackUrl query params.
 */
function sanitizeCallbackUrl(raw: string | null): string {
  const fallback = "/dashboard";
  if (!raw) return fallback;
  // Only allow relative paths starting with a single "/"
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  if (/^\/[/\\]/.test(raw)) return fallback;
  return raw;
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Resend countdown ────────────────────────────────────────────────────
  const [resendCountdown, setResendCountdown] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCountdown = useCallback(() => {
    setResendCountdown(RESEND_COOLDOWN_SECONDS);
    countdownRef.current = setInterval(() => {
      setResendCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  // ── Attempt tracking ────────────────────────────────────────────────────
  const [attemptCount, setAttemptCount] = useState(0);
  const tooManyAttempts = attemptCount >= MAX_ATTEMPTS;

  const { csrfFetch } = useCsrf();
  const errorId = useId();
  const statusId = useId();
  const resendStatusId = useId();

  // Validate the callbackUrl from the query string before use
  const callbackUrl = sanitizeCallbackUrl(searchParams.get("callbackUrl"));

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await csrfFetch("/api/v1/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setStep("otp");
      setAttemptCount(0);
      startCountdown();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendCountdown > 0 || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await csrfFetch("/api/v1/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setAttemptCount(0);
      startCountdown();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resend OTP");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tooManyAttempts) return;
    setLoading(true);
    setError(null);
    try {
      const result = await signIn("credentials", {
        phone,
        otp,
        redirect: false,
      });
      if (result?.error) throw new Error("Invalid OTP. Please try again.");
      // Redirect to the validated callbackUrl (or /dashboard as fallback)
      router.push(callbackUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  };

  /** Handle paste events on the OTP input — strip non-digits and trim to 6 chars. */
  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    setOtp(pasted);
  };

  const stepLabel =
    step === "phone"
      ? "Step 1 of 2: Enter your phone number"
      : "Step 2 of 2: Enter the verification code";

  const attemptsRemaining = MAX_ATTEMPTS - attemptCount;

  return (
    <div className={styles.page}>
      <div className={`container container--sm ${styles.inner}`}>
        <div className="card">
          {/* Live region announces step changes to screen readers */}
          <p id={statusId} className="sr-only" aria-live="polite" aria-atomic="true">
            {stepLabel}
          </p>

          <h1 className={styles.title}>
            {step === "phone" ? "Sign in to Lumigift" : "Enter your OTP"}
          </h1>
          <p className={styles.subtitle} id={`${statusId}-desc`}>
            {step === "phone"
              ? "Enter your phone number to receive a one-time code."
              : `We sent a 6-digit code to ${phone}.`}
          </p>

          {step === "phone" ? (
            <form
              onSubmit={handleSendOtp}
              className={styles.form}
              noValidate
              aria-label="Phone number sign-in form"
              aria-describedby={`${statusId}-desc`}
            >
              <Input
                label="Phone Number"
                type="tel"
                placeholder="+2348012345678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                autoComplete="tel"
                aria-label="Phone number in international format, e.g. +2348012345678"
                error={error ?? undefined}
              />
              <Button type="submit" fullWidth loading={loading}>
                Send Code
              </Button>
            </form>
          ) : (
            <form
              onSubmit={handleVerifyOtp}
              className={styles.form}
              noValidate
              aria-label="OTP verification form"
              aria-describedby={`${statusId}-desc`}
            >
              <Input
                label="6-Digit Code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="123456"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onPaste={handleOtpPaste}
                required
                autoComplete="one-time-code"
                aria-label="6-digit one-time password sent to your phone"
                aria-describedby={error ? errorId : undefined}
                error={error ?? undefined}
                disabled={tooManyAttempts}
              />

              {/* Attempt feedback — visible when user has failed at least once */}
              {attemptCount > 0 && !tooManyAttempts && (
                <p className={styles.attemptWarning} role="status" aria-live="polite">
                  {attemptsRemaining === 1
                    ? "1 attempt remaining before you are locked out."
                    : `${attemptsRemaining} attempts remaining.`}
                </p>
              )}

              {/* Lockout message */}
              {tooManyAttempts && (
                <p className={styles.error} role="alert">
                  Too many failed attempts. Please request a new code.
                </p>
              )}

              {/* Standalone error (non-lockout) */}
              {error && !tooManyAttempts && (
                <p id={errorId} className={styles.error} role="alert" aria-live="assertive">
                  {error}
                </p>
              )}

              <Button type="submit" fullWidth loading={loading} disabled={tooManyAttempts}>
                Verify &amp; Sign In
              </Button>

              {/* Resend section */}
              <div className={styles.resendWrapper}>
                {/* Hidden live region announces countdown ticks to screen readers */}
                <span id={resendStatusId} className="sr-only" aria-live="polite" aria-atomic="true">
                  {resendCountdown > 0
                    ? `Resend available in ${resendCountdown} seconds`
                    : "You can now request a new code"}
                </span>

                {resendCountdown > 0 ? (
                  <p className={styles.resendCountdown} aria-hidden="true">
                    Resend code in <span className={styles.resendTimer}>{resendCountdown}s</span>
                  </p>
                ) : (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={handleResendOtp}
                    disabled={loading}
                    aria-describedby={resendStatusId}
                  >
                    Resend code
                  </button>
                )}
              </div>

              <button
                type="button"
                className="btn btn--ghost btn--sm btn--full"
                onClick={() => {
                  setStep("phone");
                  setError(null);
                  setAttemptCount(0);
                  setResendCountdown(0);
                  if (countdownRef.current) clearInterval(countdownRef.current);
                }}
                aria-label="Go back and change your phone number"
              >
                Change number
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
