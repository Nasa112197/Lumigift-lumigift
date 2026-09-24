"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createGiftSchema } from "@/types/schemas";
import type { CreateGiftInput } from "@/types/schemas";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import {
  ApiErrorBanner,
  classifyApiError,
  type ApiErrorState,
} from "@/components/ui/ApiErrorBanner";
import { GiftPreview } from "./GiftPreview";
import { useState } from "react";
import { useCsrf } from "@/hooks/useCsrf";
import { formatNGN } from "@/lib/currency";
import { logger } from "@/lib/logger";
import styles from "./CreateGiftForm.module.css";

type Step = "form" | "preview";

export function CreateGiftForm() {
  const [step, setStep] = useState<Step>("form");
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<ApiErrorState | null>(null);
  const [usdcEquivalent, setUsdcEquivalent] = useState("…");
  const [showUnregisteredWarning, setShowUnregisteredWarning] = useState(false);
  const [recipientRegistered, setRecipientRegistered] = useState<boolean | null>(null);

  const { csrfFetch } = useCsrf();

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<CreateGiftInput>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(createGiftSchema) as any,
    defaultValues: { paymentProvider: "paystack", recipientIsRegistered: true },
    mode: "onBlur",
  });

  // Step 1 → Step 2: fetch USDC estimate then show preview
  const onFormSubmit = async (data: CreateGiftInput) => {
    setApiError(null);
    try {
      // Check if recipient is registered (GET — no CSRF needed)
      const checkRes = await fetch(
        `/api/v1/users?phone=${encodeURIComponent(data.recipientPhone)}`
      );
      if (checkRes.ok) {
        const checkJson = await checkRes.json();
        setRecipientRegistered(checkJson.data?.exists ?? false);
        if (!checkJson.data?.exists) {
          setShowUnregisteredWarning(true);
          return; // Don't proceed to preview yet
        }
      } else {
        // If check fails, assume registered to not block the happy path
        setRecipientRegistered(true);
      }

      // GET — no CSRF needed
      const res = await fetch(`/api/v1/exchange-rate?ngn=${data.amountNgn}`);
      if (res.ok) {
        const json = await res.json();
        setUsdcEquivalent(json.data?.usdc ?? "—");
      }
    } catch {
      // Exchange-rate is non-critical — preview still shows without USDC estimate
    }
    setStep("preview");
  };

  const onProceedUnregistered = async () => {
    setShowUnregisteredWarning(false);
    try {
      const data = getValues();
      const res = await fetch(`/api/v1/exchange-rate?ngn=${data.amountNgn}`);
      if (res.ok) {
        const json = await res.json();
        setUsdcEquivalent(json.data?.usdc ?? "—");
      }
    } catch {
      // non-critical
    }
    setStep("preview");
  };

  const onCancelUnregistered = () => {
    setShowUnregisteredWarning(false);
  };

  const onConfirm = async () => {
    setLoading(true);
    setApiError(null);
    try {
      const data = getValues();
      const res = await csrfFetch("/api/v1/gifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          recipientIsRegistered: recipientRegistered ?? true,
        }),
      });

      if (!res.ok) {
        let errorData: { error?: string } = {};
        try {
          errorData = await res.json();
        } catch {
          // body unreadable
        }
        // Log safely — never log recipient data or secrets
        logger.warn(
          { status: res.status, code: errorData.error ? "api_error" : "unknown" },
          "Gift creation failed"
        );
        setApiError(classifyApiError(new Error(errorData.error ?? ""), res.status));
        return;
      }

      const json = await res.json();
      const { paymentUrl } = json.data;

      // Redirect to payment
      window.location.href = paymentUrl;
    } catch (err) {
      // Log the error kind but not any sensitive values
      logger.warn(
        { message: err instanceof Error ? err.message : "unknown" },
        "Gift creation network error"
      );
      setApiError(classifyApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = () => {
    setApiError(null);
    onConfirm();
  };

  if (step === "preview") {
    return (
      <GiftPreview
        data={getValues()}
        usdcEquivalent={usdcEquivalent}
        onEdit={() => setStep("form")}
        onConfirm={onConfirm}
        onRetry={handleRetry}
        loading={loading}
        apiError={apiError}
      />
    );
  }

  return (
    <>
      <form
        className={styles.form}
        onSubmit={handleSubmit(onFormSubmit as Parameters<typeof handleSubmit>[0])}
        noValidate
      >
        <h2 className={styles.title}>Send a Gift</h2>

        <Input
          label="Recipient's Name"
          placeholder="e.g. Amara"
          error={errors.recipientName?.message}
          {...register("recipientName")}
        />

        <Input
          label="Recipient's Phone"
          type="tel"
          placeholder="+2348012345678"
          error={errors.recipientPhone?.message}
          {...register("recipientPhone")}
        />

        <Input
          label="Gift Amount (₦)"
          type="number"
          placeholder="5000"
          min={500}
          max={500000}
          error={errors.amountNgn?.message}
          {...register("amountNgn", { valueAsNumber: true })}
        />
        <p className="input-hint">
          Min {formatNGN(500)} · Max {formatNGN(500000)} · Daily limit {formatNGN(1000000)}
        </p>

        <Input
          label="Unlock Date & Time"
          type="datetime-local"
          error={errors.unlockAt?.message}
          {...register("unlockAt")}
        />

        <Textarea
          label="Personal Message (optional)"
          id="message"
          rows={3}
          placeholder="Write something heartfelt…"
          error={errors.message?.message}
          {...register("message")}
        />

        <Button type="submit" fullWidth>
          Preview Gift →
        </Button>
      </form>

      {showUnregisteredWarning && (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <h3>Unregistered Recipient</h3>
            <p>
              The recipient&apos;s phone number is not registered with Lumigift. They will receive
              an SMS invitation to claim the gift, but must register first.
            </p>
            <p>Are you sure you want to proceed?</p>
            <div className={styles.modalActions}>
              <Button onClick={onCancelUnregistered} variant="secondary">
                Cancel
              </Button>
              <Button onClick={onProceedUnregistered}>Proceed</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
