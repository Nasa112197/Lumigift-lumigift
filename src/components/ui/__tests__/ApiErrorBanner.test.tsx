/**
 * @jest-environment jsdom
 *
 * Tests for ApiErrorBanner and classifyApiError — issue #32 acceptance criteria.
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ApiErrorBanner, classifyApiError, type ApiErrorState } from "../ApiErrorBanner";

// ── classifyApiError ──────────────────────────────────────────────────────────

describe("classifyApiError", () => {
  it("classifies a network TypeError as 'network'", () => {
    const err = new TypeError("Failed to fetch");
    const result = classifyApiError(err);
    expect(result.kind).toBe("network");
    expect(result.message).toMatch(/connection/i);
  });

  it("classifies HTTP 400 as 'validation'", () => {
    const result = classifyApiError(new Error("bad input"), 400);
    expect(result.kind).toBe("validation");
    expect(result.message).toMatch(/details you entered/i);
  });

  it("classifies HTTP 402 as 'payment_init'", () => {
    const result = classifyApiError(new Error("payment failed"), 402);
    expect(result.kind).toBe("payment_init");
  });

  it("classifies HTTP 422 as 'payment_init'", () => {
    const result = classifyApiError(new Error(), 422);
    expect(result.kind).toBe("payment_init");
  });

  it("classifies HTTP 500 as 'server'", () => {
    const result = classifyApiError(new Error("internal"), 500);
    expect(result.kind).toBe("server");
    expect(result.message).toMatch(/not your fault/i);
  });

  it("classifies HTTP 503 as 'server'", () => {
    const result = classifyApiError(new Error(), 503);
    expect(result.kind).toBe("server");
  });

  it("classifies error message containing 'paystack' as 'payment_init'", () => {
    const result = classifyApiError(new Error("Paystack initialisation failed"));
    expect(result.kind).toBe("payment_init");
  });

  it("classifies error message containing 'timeout' as 'network'", () => {
    const result = classifyApiError(new Error("Request timeout exceeded"));
    expect(result.kind).toBe("network");
  });

  it("classifies unknown errors as 'unknown'", () => {
    const result = classifyApiError({ unexpected: true });
    expect(result.kind).toBe("unknown");
    expect(result.message).toMatch(/unexpected/i);
  });

  it("never exposes raw error messages that could contain secrets", () => {
    const sensitiveErr = new Error(
      "DB query failed: SELECT * FROM users WHERE token='abc123secret'"
    );
    const result = classifyApiError(sensitiveErr, 500);
    // The raw error.message should not appear in the user-facing message
    expect(result.message).not.toContain("SELECT");
    expect(result.message).not.toContain("abc123secret");
    expect(result.message).not.toContain("token=");
  });
});

// ── ApiErrorBanner ────────────────────────────────────────────────────────────

describe("ApiErrorBanner", () => {
  const validationError: ApiErrorState = {
    kind: "validation",
    message: "Some of the details you entered are invalid.",
  };

  const networkError: ApiErrorState = {
    kind: "network",
    message: "We could not reach the server.",
  };

  it("renders with role=alert so screen readers announce it", () => {
    render(<ApiErrorBanner error={validationError} />);
    const banner = screen.getByRole("alert");
    expect(banner).toBeInTheDocument();
  });

  it("displays the user-safe message", () => {
    render(<ApiErrorBanner error={validationError} />);
    expect(screen.getByText(validationError.message)).toBeInTheDocument();
  });

  it("shows the heading for the error kind", () => {
    render(<ApiErrorBanner error={validationError} />);
    expect(screen.getByText(/check your details/i)).toBeInTheDocument();
  });

  it("renders a retry button when onRetry is provided", () => {
    const onRetry = jest.fn();
    render(<ApiErrorBanner error={networkError} onRetry={onRetry} />);
    const btn = screen.getByRole("button");
    expect(btn).toBeInTheDocument();
  });

  it("calls onRetry when the retry button is clicked", () => {
    const onRetry = jest.fn();
    render(<ApiErrorBanner error={networkError} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("does not render a retry button when onRetry is absent", () => {
    render(<ApiErrorBanner error={validationError} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders different headings for each error kind", () => {
    const kinds = ["validation", "payment_init", "network", "server", "unknown"] as const;
    const headings = [
      /check your details/i,
      /payment could not be started/i,
      /connection problem/i,
      /something went wrong on our end/i,
      /unexpected error/i,
    ];
    kinds.forEach((kind, i) => {
      const { unmount } = render(<ApiErrorBanner error={{ kind, message: "test" }} />);
      expect(screen.getByText(headings[i])).toBeInTheDocument();
      unmount();
    });
  });
});
