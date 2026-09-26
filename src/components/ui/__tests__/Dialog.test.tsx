/**
 * @jest-environment jsdom
 *
 * Automated screen-reader focus-order tests for the Dialog component.
 * Covers acceptance criteria for issue #35.
 */

import React, { createRef } from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { Dialog } from "../Dialog";

describe("Dialog – accessible focus management", () => {
  function TestDialog({
    open = true,
    onClose = jest.fn(),
  }: {
    open?: boolean;
    onClose?: () => void;
  }) {
    return (
      <Dialog open={open} onClose={onClose} title="Test Dialog">
        <p>Dialog content</p>
        <button>First focusable</button>
        <button>Second focusable</button>
        <button onClick={onClose}>Close</button>
      </Dialog>
    );
  }

  it("renders with role=dialog and aria-modal", () => {
    render(<TestDialog />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("has aria-labelledby pointing to the title element", () => {
    render(<TestDialog />);
    const dialog = screen.getByRole("dialog");
    const labelId = dialog.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    const titleEl = document.getElementById(labelId!);
    expect(titleEl).toBeInTheDocument();
    expect(titleEl?.textContent).toBe("Test Dialog");
  });

  it("closes on Escape key press", () => {
    const onClose = jest.fn();
    render(<TestDialog onClose={onClose} />);
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not render when open=false", () => {
    render(<TestDialog open={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("returns focus to trigger element on close", async () => {
    const triggerRef = createRef<HTMLButtonElement>();

    function Wrapper() {
      const [open, setOpen] = React.useState(true);
      return (
        <>
          <button ref={triggerRef}>Trigger</button>
          <Dialog
            open={open}
            onClose={() => setOpen(false)}
            triggerRef={triggerRef as React.RefObject<HTMLElement | null>}
            title="Focus Return Test"
          >
            <button onClick={() => setOpen(false)}>Close Dialog</button>
          </Dialog>
        </>
      );
    }

    render(<Wrapper />);

    const closeBtn = screen.getByText("Close Dialog");
    act(() => {
      fireEvent.click(closeBtn);
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    expect(document.activeElement).toBe(triggerRef.current);
  });

  it("closes on backdrop click", () => {
    const onClose = jest.fn();
    render(<TestDialog onClose={onClose} />);
    // The backdrop is the element with the onClick handler — its data-testid or class
    const backdrop = document.querySelector("[class*='backdrop']") as HTMLElement;
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
