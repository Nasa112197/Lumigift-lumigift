"use client";

import { useState, useRef, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createGiftSchema, type CreateGiftInput, type CreateGiftFormInput } from "@/types/schemas";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { TemplateSelector } from "./TemplateSelector";
import { WizardProgress } from "./WizardProgress";
import { GiftPreviewCard } from "./GiftPreviewCard";
import { BLANK_TEMPLATE, type GiftTemplate } from "@/lib/giftTemplates";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import styles from "./GiftWizard.module.css";

// Step indices
const STEP_OCCASION = 0;
const STEP_RECIPIENT = 1;
const STEP_AMOUNT = 2;
const STEP_UNLOCK = 3;
const STEP_REVIEW = 4;

/**
 * Outcome of the last mutation attempt.
 *
 * - `idle`    — no submission yet.
 * - `pending` — request in flight.
 * - `unknown` — request was sent but connectivity dropped before a response
 *               arrived; we cannot confirm success or failure.
 * - `error`   — server returned an error response.
 * - `success` — server returned success.
 */
type MutationOutcome = "idle" | "pending" | "unknown" | "error" | "success";

export function GiftWizard() {
  const [step, setStep] = useState(STEP_OCCASION);
  const [template, setTemplate] = useState<GiftTemplate>(BLANK_TEMPLATE);
  const [error, setError] = useState<string | null>(null);
  const [mutationOutcome, setMutationOutcome] = useState<MutationOutcome>("idle");

  const { isOnline } = useNetworkStatus();

  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    trigger,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<CreateGiftFormInput>({
    resolver: zodResolver(createGiftSchema),
    defaultValues: { paymentProvider: "paystack", recipientIsRegistered: false },
    mode: "onTouched",
  });

  /**
   * Idempotency key — generated once per wizard session.
   * Sending the same key on a retry lets the server recognise the duplicate
   * and return the original result instead of creating a second gift.
   */
  const idempotencyKeyRef = useRef<string>(
    typeof crypto !== "undefined" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  );

  function handleTemplateSelect(tpl: GiftTemplate) {
    setTemplate(tpl);
    if (tpl.suggestedMessage) {
      setValue("message", tpl.suggestedMessage);
    }
    setStep(STEP_RECIPIENT);
  }

  async function next(fields: (keyof CreateGiftFormInput)[]) {
    if (navigating) return;
    setNavigating(true);
    const valid = await trigger(fields);
    if (valid) setStep((s) => s + 1);
    setNavigating(false);
  }

  function back() {
    setStep((s) => Math.max(0, s - 1));
  }

  const doSubmit = useCallback(
    async (data: CreateGiftFormInput) => {
      if (!isOnline) {
        setError("You appear to be offline. Please check your connection and try again.");
        return;
      }

      setLoading(true);
      setError(null);
      setMutationOutcome("pending");

      // Track whether we received any HTTP response before a potential error
      let responseReceived = false;

      try {
        const res = await fetch("/api/gifts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // The server can use this key to detect and deduplicate retries,
            // preventing a second gift from being created on reconnect.
            "Idempotency-Key": idempotencyKeyRef.current,
          },
          body: JSON.stringify(data),
        });

        responseReceived = true;
        const json = await res.json();

        if (!json.success) {
          setMutationOutcome("error");
          throw new Error(json.error);
        }

        setMutationOutcome("success");
        window.location.href = json.data.paymentUrl;
      } catch (err) {
        if (!responseReceived) {
          // No HTTP response arrived — likely a connectivity drop mid-flight.
          // We explicitly flag this as "unknown" so the UI can communicate the
          // ambiguity rather than showing a plain error message.
          setMutationOutcome("unknown");
          setError(
            "Your connection dropped while the request was in flight. " +
              "We don\u2019t know if it was received. " +
              "Reconnect and press \u2018Retry\u2019 \u2014 it will not create a duplicate gift."
          );
        } else {
          setMutationOutcome("error");
          setError(err instanceof Error ? err.message : "Something went wrong");
        }
      } finally {
        setLoading(false);
      }
    },
    [isOnline]
  );

  const onSubmit = async (data: CreateGiftFormInput) => {
    await doSubmit(data);
  };

  /** Safe retry — reuses the same idempotency key so the server can deduplicate. */
  const handleRetry = () => {
    const data = getValues();
    doSubmit(data as CreateGiftFormInput);
  };

  const canRetry = mutationOutcome === "unknown" || mutationOutcome === "error";

  return (
    <div className={styles.wrapper}>
      {step > STEP_OCCASION && <WizardProgress currentStep={step} />}

      {/* Offline / reconnect banner — scoped to the review step where the
          mutation fires, to avoid confusing users on earlier wizard steps. */}
      {step === STEP_REVIEW && <OfflineBanner onRetry={canRetry ? handleRetry : undefined} />}

      {step === STEP_OCCASION && <TemplateSelector onSelect={handleTemplateSelect} />}

      {step === STEP_RECIPIENT && (
        <div className={styles.stepContent}>
          <h2 className={styles.stepTitle}>Who is this gift for?</h2>
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
            label="Recipient's Email (optional — for email notifications)"
            type="email"
            placeholder="amara@example.com"
            error={errors.recipientEmail?.message}
            {...register("recipientEmail")}
          />
          <div className={styles.nav}>
            <Button variant="secondary" onClick={back}>
              Back
            </Button>
            <Button onClick={() => next(["recipientName", "recipientPhone"])} loading={navigating}>
              Next
            </Button>
          </div>
        </div>
      )}

      {step === STEP_AMOUNT && (
        <div className={styles.stepContent}>
          <h2 className={styles.stepTitle}>Amount &amp; Message</h2>
          <Input
            label="Gift Amount (₦)"
            type="number"
            placeholder="5000"
            min={500}
            error={errors.amountNgn?.message}
            {...register("amountNgn", { valueAsNumber: true })}
          />
          <div className="input-group">
            <label className="input-label" htmlFor="message">
              Personal Message (optional)
            </label>
            <textarea
              id="message"
              className="input"
              rows={4}
              placeholder="Write something heartfelt…"
              {...register("message")}
            />
            {errors.message && <span className="input-error-msg">{errors.message.message}</span>}
          </div>
          <div className={styles.nav}>
            <Button variant="secondary" onClick={back}>
              Back
            </Button>
            <Button onClick={() => next(["amountNgn"])} loading={navigating}>
              Next
            </Button>
          </div>
        </div>
      )}

      {step === STEP_UNLOCK && (
        <div className={styles.stepContent}>
          <h2 className={styles.stepTitle}>When should it unlock?</h2>
          <Input
            label="Unlock Date &amp; Time"
            type="datetime-local"
            error={errors.unlockAt?.message}
            {...register("unlockAt")}
          />
          <div className={styles.nav}>
            <Button variant="secondary" onClick={back}>
              Back
            </Button>
            <Button onClick={() => next(["unlockAt"])} loading={navigating}>
              Review Gift
            </Button>
          </div>
        </div>
      )}

      {step === STEP_REVIEW && (
        <form onSubmit={handleSubmit(onSubmit as Parameters<typeof handleSubmit>[0])} noValidate>
          <h2 className={styles.stepTitle}>Review your gift</h2>
          <GiftPreviewCard
            data={getValues()}
            template={template}
            onEdit={(targetStep) => setStep(targetStep)}
          />

          {/* Distinguish "unknown outcome" (connectivity drop mid-flight) from
              a confirmed server error so the user understands the difference. */}
          {error && mutationOutcome === "unknown" && (
            <p className={styles.unknownOutcome} role="status" aria-live="polite">
              {error}
            </p>
          )}
          {error && mutationOutcome === "error" && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          <div className={styles.nav}>
            <Button type="button" variant="secondary" onClick={back} disabled={loading}>
              Back
            </Button>
            <Button type="submit" loading={loading} disabled={!isOnline}>
              {isOnline ? "Continue to Payment" : "Offline…"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
