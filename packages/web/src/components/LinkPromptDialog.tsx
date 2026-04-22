/**
 * Modal dialog for inserting a markdown-style link.
 *
 * Captures both an optional human-readable label and a URL, mirroring
 * markdown's `[label](url)` shape. Pre-fills the label with the
 * currently selected text in the composer when the user opens the
 * dialog so a one-shot "select word → ⌘⇧U → paste URL" flow Just
 * Works.
 *
 * Press Enter in either field to submit, Esc to cancel (Esc handling
 * lives in `Modal`).
 */
import { Button, Modal } from "@collabai/ui";
import { useEffect, useRef, useState } from "react";
import { useTranslator } from "../lib/i18n/index.ts";

export interface LinkPromptDialogProps {
  title: string;
  description?: string;
  defaultLabel?: string;
  defaultUrl?: string;
  labelFieldLabel: string;
  urlFieldLabel: string;
  labelPlaceholder?: string;
  urlPlaceholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: (value: { url: string; label: string }) => void;
  onCancel: () => void;
}

export function LinkPromptDialog({
  title,
  description,
  defaultLabel = "",
  defaultUrl = "",
  labelFieldLabel,
  urlFieldLabel,
  labelPlaceholder,
  urlPlaceholder,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: LinkPromptDialogProps) {
  const { t } = useTranslator();
  const [label, setLabel] = useState(defaultLabel);
  const [url, setUrl] = useState(defaultUrl);
  const labelRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // If the caller already filled in a label (because the user had
    // selected text in the composer), focus the URL field — that's
    // the one piece of information we still need. Otherwise focus the
    // label field so the user can type both naturally top-down.
    const target = defaultLabel ? urlRef.current : labelRef.current;
    if (!target) return;
    target.focus();
    target.select();
  }, [defaultLabel]);

  const confirmText = confirmLabel ?? t("dialogs.confirm");
  const cancelText = cancelLabel ?? t("common.cancel");

  function submit() {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    onConfirm({ url: trimmedUrl, label: label.trim() });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  }

  return (
    <Modal title={title} onClose={onCancel} size="sm" ariaLabel={title}>
      <div className="flex flex-col gap-3 p-4">
        {description && (
          <p className="text-sm leading-relaxed text-secondary">{description}</p>
        )}
        <label className="flex flex-col gap-1 text-xs font-medium text-secondary">
          {labelFieldLabel}
          <input
            ref={labelRef}
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={labelPlaceholder}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm font-normal text-foreground placeholder:text-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-secondary">
          {urlFieldLabel}
          <input
            ref={urlRef}
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={urlPlaceholder}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm font-normal text-foreground placeholder:text-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {cancelText}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={submit}
            disabled={url.trim().length === 0}
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
