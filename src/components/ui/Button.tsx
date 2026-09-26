import { clsx } from "clsx";
import { forwardRef } from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    fullWidth = false,
    loading = false,
    disabled,
    children,
    className,
    ...props
  },
  ref
) {
  return (
    <button
      ref={ref}
      className={clsx(
        "btn",
        `btn--${variant}`,
        size !== "md" && `btn--${size}`,
        fullWidth && "btn--full",
        className
      )}
      disabled={disabled || loading}
      aria-busy={loading}
      {...props}
    >
      {loading ? <span className="sr-only">Loading…</span> : children}
      {loading && <span aria-hidden="true">…</span>}
    </button>
  );
});

Button.displayName = "Button";
