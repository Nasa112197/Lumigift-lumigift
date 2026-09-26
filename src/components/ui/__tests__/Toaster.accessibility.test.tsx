/**
 * Toast accessibility tests (#42)
 *
 * Verifies that:
 * - Error/warning toasts use role="alert" (assertive)
 * - Success/info toasts use role="status" (polite)
 * - Each toast has aria-atomic="true"
 * - Severity labels are present for screen readers (sr-only text)
 * - Dismiss button has a descriptive aria-label
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ToastProvider, useToast } from "../ToastContext";
import { Toaster } from "../Toaster";

// Helper component that triggers toasts via useToast
function ToastTrigger({
  message,
  variant,
}: {
  message: string;
  variant: "success" | "error" | "warning" | "info";
}) {
  const { addToast } = useToast();
  return (
    <button onClick={() => addToast(message, variant)}>
      Add {variant} toast
    </button>
  );
}

function TestApp({
  message,
  variant,
}: {
  message: string;
  variant: "success" | "error" | "warning" | "info";
}) {
  return (
    <ToastProvider>
      <ToastTrigger message={message} variant={variant} />
      <Toaster />
    </ToastProvider>
  );
}

function addToast(message: string, variant: "success" | "error" | "warning" | "info") {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`add ${variant} toast`, "i") }));
}

describe("Toaster accessibility", () => {
  it("error toast uses role=alert", () => {
    render(<TestApp message="Payment failed" variant="error" />);
    addToast("Payment failed", "error");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("warning toast uses role=alert", () => {
    render(<TestApp message="Session expiring" variant="warning" />);
    addToast("Session expiring", "warning");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("success toast uses role=status", () => {
    render(<TestApp message="Gift created!" variant="success" />);
    addToast("Gift created!", "success");
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("info toast uses role=status", () => {
    render(<TestApp message="Loading…" variant="info" />);
    addToast("Loading…", "info");
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("error toast has aria-atomic=true", () => {
    render(<TestApp message="Something went wrong" variant="error" />);
    addToast("Something went wrong", "error");
    expect(screen.getByRole("alert")).toHaveAttribute("aria-atomic", "true");
  });

  it("success toast has aria-atomic=true", () => {
    render(<TestApp message="Done!" variant="success" />);
    addToast("Done!", "success");
    expect(screen.getByRole("status")).toHaveAttribute("aria-atomic", "true");
  });

  it("error toast has aria-live=assertive", () => {
    render(<TestApp message="Error occurred" variant="error" />);
    addToast("Error occurred", "error");
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
  });

  it("success toast has aria-live=polite", () => {
    render(<TestApp message="All good!" variant="success" />);
    addToast("All good!", "success");
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("screen-reader severity label is present in error toast", () => {
    render(<TestApp message="Upload failed" variant="error" />);
    addToast("Upload failed", "error");
    expect(screen.getByText(/error:/i)).toBeInTheDocument();
  });

  it("screen-reader severity label is present in success toast", () => {
    render(<TestApp message="Saved!" variant="success" />);
    addToast("Saved!", "success");
    expect(screen.getByText(/success:/i)).toBeInTheDocument();
  });

  it("dismiss button has a descriptive aria-label for error", () => {
    render(<TestApp message="Network error" variant="error" />);
    addToast("Network error", "error");
    expect(
      screen.getByRole("button", { name: /dismiss error notification/i })
    ).toBeInTheDocument();
  });

  it("dismiss button has a descriptive aria-label for success", () => {
    render(<TestApp message="Done" variant="success" />);
    addToast("Done", "success");
    expect(
      screen.getByRole("button", { name: /dismiss success notification/i })
    ).toBeInTheDocument();
  });

  it("clicking dismiss removes the toast", () => {
    render(<TestApp message="This will be dismissed" variant="success" />);
    addToast("This will be dismissed", "success");
    expect(screen.getByText("This will be dismissed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /dismiss success notification/i }));
    expect(screen.queryByText("This will be dismissed")).not.toBeInTheDocument();
  });

  it("notification container has aria-label", () => {
    render(
      <ToastProvider>
        <Toaster />
      </ToastProvider>
    );
    expect(screen.getByLabelText("Notifications")).toBeInTheDocument();
  });
});
