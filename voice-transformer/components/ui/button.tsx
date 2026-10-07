import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  leadingIcon?: ReactNode;
};

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-foreground shadow-sm hover:bg-accent-hover active:bg-accent-hover disabled:hover:bg-accent",
  secondary:
    "border border-border bg-surface text-foreground hover:bg-surface-muted active:bg-surface-muted",
  ghost: "text-muted hover:bg-surface-muted hover:text-foreground",
  danger: "bg-danger text-white shadow-sm hover:bg-danger-hover active:bg-danger-hover",
};

const SIZE_CLASSES: Record<Size, string> = {
  md: "h-11 px-4 text-sm",
  lg: "h-12 px-5 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  leadingIcon,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...rest}
    >
      {leadingIcon ? <span aria-hidden="true" className="shrink-0">{leadingIcon}</span> : null}
      {children}
    </button>
  );
}
