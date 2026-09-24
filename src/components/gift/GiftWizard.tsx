"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createGiftSchema, type CreateGiftInput, type CreateGiftFormInput } from "@/types/schemas";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  ApiErrorBanner,
  classifyApiError,
  type ApiErrorState,
} from "@/components/ui/ApiErrorBanner";
import { TemplateSelector } from "./TemplateSelector";
import { WizardProgress } from "./WizardProgress";
import { GiftPreviewCard } from "./GiftPreviewCard";
import { BLANK_TEMPLATE, type GiftTemplate } from "@/lib/giftTemplates";
import { logger } from "@/lib/logger";
import styles from "./GiftWizard.module.css";

// Step indices
const STEP_OCCASION = 0;
const STEP_RECIPIENT = 1;
const STEP_AMOUNT = 2;
const STEP_UNLOCK = 3;
const STEP_REVIEW = 4;

export function GiftWizard() {
  const [step, setStep] = useState(STEP_OCCASION);
  const [template, setTemplate] = useState<GiftTemplate>(BLANK_TEMPLATE);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<ApiErrorState | null>(null);

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

  function handleTemplateSelect(tpl: GiftTemplate) {
    setTemplate(tpl);
    if (tpl.suggestedMessage) {
      setValue("message", tpl.suggestedMessage);
    }
    setStep(STEP_RECIPIENT);
  }

  async function next(fields: (keyof CreateGiftFormInput)[]) {
    const valid = await trigger(fields);
    if (valid) setStep((s) => s + 1);
  }

  function back() {
    setStep((s) => Math.max(0, s - 1));
  }

  const onSubmit = async (data: CreateGiftFormInput) => {
    setLoading(true);
    setApiError(null);
    try {
      const res = await fetch("/api/gifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        let errorData: { error?: string } = {};
        try {
          errorData = await res.json();
        } catch {
          // body unreadable
        }
        // Log error kind without exposing recipient data
        logger.warn({ status: res.status }, "GiftWizard submission failed");
        setApiError(classifyApiError(new Error(errorData.error ?? ""), res.status));
        return;
      }

      const json = await res.json();
      if (!json.success) {
        setApiError(classifyApiError(new Error(json.error ?? "")));
        return;
      }

      window.location.href = json.data.paymentUrl;
    } catch (err) {
      logger.warn(
        { message: err instanceof Error ? err.message : "unknown" },
        "GiftWizard network error"
      );
      setApiError(classifyApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = () => {
    setApiError(null);
    handleSubmit(onSubmit)();
  };

  return (
    <div className={styles.wrapper}>
      {step > STEP_OCCASION && <WizardProgress currentStep={step} />}

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
            <Button onClick={() => next(["recipientName", "recipientPhone"])}>Next</Button>
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
            <Button onClick={() => next(["amountNgn"])}>Next</Button>
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
            <Button onClick={() => next(["unlockAt"])}>Review Gift</Button>
          </div>
        </div>
      )}

      {step === STEP_REVIEW && (
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <h2 className={styles.stepTitle}>Review your gift</h2>
          <GiftPreviewCard
            data={getValues()}
            template={template}
            onEdit={(targetStep) => setStep(targetStep)}
          />
          {apiError && <ApiErrorBanner error={apiError} onRetry={handleRetry} />}
          <div className={styles.nav}>
            <Button type="button" variant="secondary" onClick={back}>
              Back
            </Button>
            <Button type="submit" loading={loading}>
              Continue to Payment
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
