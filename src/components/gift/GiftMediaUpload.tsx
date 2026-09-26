"use client";

/**
 * GiftMediaUpload
 *
 * A file-picker component for gift media images that:
 * - Validates file type and size **client-side** before the file is sent
 *   to the server, surfacing human-readable errors immediately.
 * - Shows a safe object URL preview that is revoked when the component
 *   unmounts or a new file is selected, so local file paths are never
 *   exposed in the DOM.
 * - Constrains the preview to a fixed aspect ratio to prevent overflow.
 * - Passes validation errors back to the parent via the `onError` callback
 *   so they can be rendered in context.
 */

import { useRef, useState, useEffect, useId } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/Button";
import styles from "./GiftMediaUpload.module.css";

// ── Validation constants ──────────────────────────────────────────────────────
/** Max file size in bytes (5 MB — must match the server-side limit). */
const MAX_BYTES = 5 * 1024 * 1024;

/** Human-readable size label for error messages. */
const MAX_SIZE_LABEL = "5 MB";

/** Allowed MIME types (must match the server-side allow-list). */
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/** Human-readable list of allowed extensions for error messages. */
const ALLOWED_EXTENSIONS_LABEL = "JPEG, PNG, WebP, or GIF";

// ── Types ─────────────────────────────────────────────────────────────────────
export interface GiftMediaUploadProps {
  /**
   * Called with the validated File when the user picks a file that passes
   * all client-side checks.
   */
  onFileSelected: (file: File) => void;
  /**
   * Called with a human-readable error message when the selected file
   * fails validation. Called with `null` when the error is cleared.
   */
  onError?: (message: string | null) => void;
  /** Whether the upload action is in progress (disables the picker). */
  uploading?: boolean;
  /** Current upload error from the server (displayed alongside the preview). */
  uploadError?: string | null;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function GiftMediaUpload({
  onFileSelected,
  onError,
  uploading = false,
  uploadError,
}: GiftMediaUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const errorId = useId();
  const inputId = useId();

  // Revoke the object URL when the component unmounts or a new URL is created
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function clearPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setFileName(null);
  }

  function setError(msg: string | null) {
    setValidationError(msg);
    onError?.(msg);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];

    // Reset input value so re-selecting the same file triggers onChange again
    e.target.value = "";

    if (!file) return;

    // ── Validate type ───────────────────────────────────────────────────────
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      clearPreview();
      setError(
        `Unsupported file type "${file.type}". Please choose a ${ALLOWED_EXTENSIONS_LABEL} image.`
      );
      return;
    }

    // ── Validate size ───────────────────────────────────────────────────────
    if (file.size > MAX_BYTES) {
      clearPreview();
      setError(
        `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum allowed size is ${MAX_SIZE_LABEL}.`
      );
      return;
    }

    // ── All checks passed ───────────────────────────────────────────────────
    setError(null);

    // Revoke previous preview URL before creating a new one
    if (previewUrl) URL.revokeObjectURL(previewUrl);

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    setFileName(file.name);
    onFileSelected(file);
  }

  const displayError = validationError ?? uploadError;

  return (
    <div className={styles.wrapper}>
      {/* Hidden file input — only image MIME types accepted */}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className={styles.hiddenInput}
        aria-hidden="true"
        tabIndex={-1}
        onChange={handleChange}
        disabled={uploading}
      />

      {/* Preview area */}
      {previewUrl ? (
        <div className={styles.previewContainer}>
          {/* next/image keeps the preview from overflowing its container */}
          <div className={styles.previewImageWrapper}>
            <Image
              src={previewUrl}
              alt={`Preview of ${fileName ?? "selected image"}`}
              fill
              sizes="(max-width: 640px) 100vw, 480px"
              className={styles.previewImage}
              unoptimized // object URL — no Next.js image optimization needed
            />
          </div>
          <p className={styles.fileName} aria-label="Selected file name">
            {fileName}
          </p>
        </div>
      ) : (
        <div className={styles.placeholder} aria-hidden="true">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
          <p>No image selected</p>
        </div>
      )}

      {/* Error message */}
      {displayError && (
        <p id={errorId} className={styles.errorMessage} role="alert" aria-live="assertive">
          {displayError}
        </p>
      )}

      {/* Picker button — labeled for screen readers */}
      <Button
        type="button"
        variant="secondary"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        aria-controls={inputId}
        aria-describedby={displayError ? errorId : undefined}
      >
        {previewUrl ? "Change image" : "Choose image"}
      </Button>

      <p className={styles.hint}>
        {ALLOWED_EXTENSIONS_LABEL} · Max {MAX_SIZE_LABEL}
      </p>
    </div>
  );
}
