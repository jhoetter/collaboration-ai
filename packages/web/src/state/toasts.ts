import { create } from "zustand";
import type { ToastTone } from "@collabai/ui";

export interface ToastEntry {
  id: string;
  title?: string;
  description?: string;
  tone: ToastTone;
  action?: { label: string; onClick: () => void };
  /** Auto-dismiss after this many milliseconds. Set to 0 to keep until manually closed. */
  durationMs: number;
}

export interface ToastsState {
  items: ToastEntry[];
  push(toast: Omit<ToastEntry, "id" | "tone" | "durationMs"> & {
    id?: string;
    tone?: ToastTone;
    durationMs?: number;
  }): string;
  dismiss(id: string): void;
}

export const useToasts = create<ToastsState>((set) => ({
  items: [],
  push(toast) {
    const id =
      toast.id ?? (typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `toast_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    const entry: ToastEntry = {
      id,
      title: toast.title,
      description: toast.description,
      tone: toast.tone ?? "info",
      action: toast.action,
      durationMs: toast.durationMs ?? 5000,
    };
    set((s) => ({ items: [...s.items.filter((t) => t.id !== id), entry] }));
    if (entry.durationMs > 0 && typeof window !== "undefined") {
      window.setTimeout(() => {
        set((s) => ({ items: s.items.filter((t) => t.id !== id) }));
      }, entry.durationMs);
    }
    return id;
  },
  dismiss(id) {
    set((s) => ({ items: s.items.filter((t) => t.id !== id) }));
  },
}));
