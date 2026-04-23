/**
 * Promise-based imperative `confirm` / `prompt` API for the web app.
 *
 * Mount {@link DialogProvider} once near the root of the tree (see
 * `main.tsx`); call sites then use {@link useDialogs} to reach for
 * `confirm({...})` and `prompt({...})` without juggling local state.
 *
 * ```tsx
 * const { confirm } = useDialogs();
 * if (!(await confirm({ title: "Leave?", description: "..." }))) return;
 * ```
 *
 * Inspired by `~/repos/hof-os`'s `ConfirmDialog`, with the addition of a
 * Promise wrapper so call sites read like the native `window.confirm`
 * they replace.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { LinkPromptDialog } from "../components/LinkPromptDialog.tsx";
import { PromptDialog } from "../components/PromptDialog.tsx";
import { useTranslator } from "./i18n/index.ts";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busyLabel?: string;
  destructive?: boolean;
}

export interface PromptOptions {
  title: string;
  description?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  readOnly?: boolean;
}

export interface LinkPromptOptions {
  title?: string;
  description?: string;
  defaultLabel?: string;
  defaultUrl?: string;
  confirmLabel?: string;
}

export interface LinkPromptResult {
  url: string;
  /** Display label; empty when the user accepted with an empty label field. */
  label: string;
}

interface DialogsApi {
  /** Returns `true` when the user confirms, `false` on cancel/dismiss. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Returns the entered string, or `null` when the user cancels/dismisses. */
  prompt: (options: PromptOptions) => Promise<string | null>;
  /** Returns the URL + label pair, or `null` when the user cancels/dismisses. */
  linkPrompt: (options?: LinkPromptOptions) => Promise<LinkPromptResult | null>;
}

const DialogsContext = createContext<DialogsApi | null>(null);

type ConfirmState = ConfirmOptions & {
  resolve: (value: boolean) => void;
};

type PromptState = PromptOptions & {
  resolve: (value: string | null) => void;
};

type LinkPromptState = LinkPromptOptions & {
  resolve: (value: LinkPromptResult | null) => void;
};

export function DialogProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslator();
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [promptState, setPromptState] = useState<PromptState | null>(null);
  const [linkPromptState, setLinkPromptState] = useState<LinkPromptState | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ ...options, resolve });
    });
  }, []);

  const prompt = useCallback((options: PromptOptions): Promise<string | null> => {
    return new Promise<string | null>((resolve) => {
      setPromptState({ ...options, resolve });
    });
  }, []);

  const linkPrompt = useCallback((options: LinkPromptOptions = {}): Promise<LinkPromptResult | null> => {
    return new Promise<LinkPromptResult | null>((resolve) => {
      setLinkPromptState({ ...options, resolve });
    });
  }, []);

  const api = useMemo<DialogsApi>(() => ({ confirm, prompt, linkPrompt }), [confirm, prompt, linkPrompt]);

  function closeConfirm(result: boolean) {
    if (!confirmState) return;
    confirmState.resolve(result);
    setConfirmState(null);
  }

  function closePrompt(result: string | null) {
    if (!promptState) return;
    promptState.resolve(result);
    setPromptState(null);
  }

  function closeLinkPrompt(result: LinkPromptResult | null) {
    if (!linkPromptState) return;
    linkPromptState.resolve(result);
    setLinkPromptState(null);
  }

  return (
    <DialogsContext.Provider value={api}>
      {children}
      {confirmState && (
        <ConfirmDialog
          title={confirmState.title}
          description={confirmState.description}
          confirmLabel={confirmState.confirmLabel}
          cancelLabel={confirmState.cancelLabel}
          busyLabel={confirmState.busyLabel}
          destructive={confirmState.destructive}
          onCancel={() => closeConfirm(false)}
          onConfirm={() => closeConfirm(true)}
        />
      )}
      {promptState && (
        <PromptDialog
          title={promptState.title}
          description={promptState.description}
          defaultValue={promptState.defaultValue}
          placeholder={promptState.placeholder}
          confirmLabel={promptState.confirmLabel}
          cancelLabel={promptState.cancelLabel}
          readOnly={promptState.readOnly}
          onCancel={() => closePrompt(null)}
          onConfirm={(value) => closePrompt(promptState.readOnly ? null : value === "" ? null : value)}
        />
      )}
      {linkPromptState && (
        <LinkPromptDialog
          title={linkPromptState.title ?? t("dialogs.linkTitle")}
          description={linkPromptState.description ?? t("composer.linkPrompt")}
          defaultLabel={linkPromptState.defaultLabel ?? ""}
          defaultUrl={linkPromptState.defaultUrl ?? "https://"}
          labelFieldLabel={t("dialogs.linkLabelField")}
          urlFieldLabel={t("dialogs.linkUrlField")}
          labelPlaceholder={t("dialogs.linkLabelPlaceholder")}
          urlPlaceholder="https://example.com"
          confirmLabel={linkPromptState.confirmLabel ?? t("dialogs.linkConfirm")}
          onCancel={() => closeLinkPrompt(null)}
          onConfirm={(value) => closeLinkPrompt(value)}
        />
      )}
    </DialogsContext.Provider>
  );
}

export function useDialogs(): DialogsApi {
  const ctx = useContext(DialogsContext);
  if (!ctx) {
    throw new Error("useDialogs must be used within <DialogProvider>");
  }
  return ctx;
}
