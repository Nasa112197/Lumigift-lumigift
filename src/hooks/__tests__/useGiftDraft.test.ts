/**
 * @jest-environment jsdom
 *
 * Tests for useGiftDraft hook — issue #33 acceptance criteria.
 */

import { renderHook, act } from "@testing-library/react";
import { useGiftDraft, type GiftDraft } from "../useGiftDraft";

const STORAGE_KEY = "lumigift_gift_draft_v1";

function clearStorage() {
  sessionStorage.clear();
}

beforeEach(clearStorage);
afterEach(clearStorage);

describe("useGiftDraft", () => {
  it("returns null when no draft exists", () => {
    const { result } = renderHook(() => useGiftDraft());
    expect(result.current.readDraft()).toBeNull();
  });

  it("saves and reads back a valid draft", () => {
    const { result } = renderHook(() => useGiftDraft());

    const draft: GiftDraft = {
      step: 2,
      recipientName: "Amara",
      amountNgn: 5000,
      message: "Happy birthday!",
      unlockAt: "2030-01-01T00:00",
    };

    act(() => {
      result.current.saveDraft(draft);
    });

    expect(result.current.readDraft()).toMatchObject(draft);
  });

  it("clears the draft from sessionStorage", () => {
    const { result } = renderHook(() => useGiftDraft());

    act(() => {
      result.current.saveDraft({ step: 1, recipientName: "Temi" });
    });

    act(() => {
      result.current.clearDraft();
    });

    expect(result.current.readDraft()).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("does NOT store phone numbers — phone field is absent from the type", () => {
    // This is a compile-time guarantee enforced by GiftDraft type,
    // but we also verify no 'phone' key ends up in sessionStorage.
    const { result } = renderHook(() => useGiftDraft());

    act(() => {
      result.current.saveDraft({ step: 1, recipientName: "Joe" });
    });

    const raw = sessionStorage.getItem(STORAGE_KEY);
    expect(raw).not.toContain("phone");
  });

  it("does NOT store payment secrets — paymentProvider field is absent", () => {
    const { result } = renderHook(() => useGiftDraft());

    act(() => {
      result.current.saveDraft({ step: 3, amountNgn: 10000 });
    });

    const raw = sessionStorage.getItem(STORAGE_KEY);
    expect(raw).not.toContain("payment");
    expect(raw).not.toContain("secret");
    expect(raw).not.toContain("otp");
  });

  it("returns null for malformed sessionStorage data", () => {
    sessionStorage.setItem(STORAGE_KEY, "not-valid-json{{");
    const { result } = renderHook(() => useGiftDraft());
    expect(result.current.readDraft()).toBeNull();
  });

  it("returns null when stored object lacks a numeric step", () => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ recipientName: "no step" }));
    const { result } = renderHook(() => useGiftDraft());
    expect(result.current.readDraft()).toBeNull();
  });

  it("uses sessionStorage (not localStorage) so data is tab-scoped", () => {
    const localSpy = jest.spyOn(Storage.prototype, "setItem");
    const { result } = renderHook(() => useGiftDraft());

    act(() => {
      result.current.saveDraft({ step: 1 });
    });

    // The setItem call should be on sessionStorage, not localStorage
    // We verify by checking sessionStorage has the key and localStorage does not
    expect(sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    localSpy.mockRestore();
  });
});
