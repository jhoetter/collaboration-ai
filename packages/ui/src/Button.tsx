import * as React from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/85",
  secondary: "bg-hover text-foreground hover:bg-border active:bg-border",
  ghost: "bg-transparent text-secondary hover:bg-hover hover:text-foreground active:bg-hover",
  danger: "bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/85",
};

const SIZE_CLASS: Record<Size, string> = {
  sm: "h-7 px-2 text-xs rounded-md",
  md: "h-9 px-3 text-sm rounded-md",
};

export function Button({ variant = "secondary", size = "md", className, type, ...rest }: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      className={cn(
        "inline-flex select-none items-center justify-center gap-1.5 font-medium transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className
      )}
      {...rest}
    />
  );
}
