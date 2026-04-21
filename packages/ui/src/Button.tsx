import * as React from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "bg-foreground text-background hover:bg-foreground/90",
  secondary: "bg-hover text-foreground hover:bg-divider",
  ghost: "bg-transparent text-secondary hover:bg-hover hover:text-foreground",
  danger: "bg-[var(--error,#D84B3E)] text-white hover:opacity-90",
};

const SIZE_CLASS: Record<Size, string> = {
  sm: "h-7 px-2 text-xs rounded",
  md: "h-9 px-3 text-sm rounded-md",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className
      )}
      {...rest}
    />
  );
}
