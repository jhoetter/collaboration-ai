/**
 * Modal prompt dialog — drop-in replacement for `window.prompt`.
 *
 * Supports two flavours:
 *
 *   1. **Editable** (default) — captures a string from the user, e.g.
 *      pasting a URL into the composer's link picker.
 *   2. **Read-only** (`readOnly`) — surfaces a value the user cannot
 *      modify, e.g. a permalink fallback when the clipboard API is
 *      unavailable. The user can still select & copy from the field.
 *
 * Press Enter to confirm, Esc to cancel (Esc handling lives in `Modal`).
 */
import { Button, Modal } from "@collabai/ui";
import { useEffect, useRef, useState } from "react";
import { useTranslator } from "../lib/i18n/index.ts";

export interface PromptDialogProps {
  title: string;
  description?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true, the input is read-only — useful for "copy this value" prompts. */
  readOnly?: boolean;
  /** Fire when the user accepts the input. Receives the (trimmed) value or `null` if empty. */
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function PromptDialog({
  title,
  description,
  defaultValue = "",
  placeholder,
  confirmLabel,
  cancelLabel,
  readOnly = false,
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const { t } = useTranslator();
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Auto-focus + select-all so the user can either type fresh content
    // or hit Cmd-C immediately on a read-only payload.
    const node = inputRef.current;
    if (!node) return;
    node.focus();
    node.select();
  }, []);

  const confirmText = confirmLabel ?? (readOnly ? t("common.close") : t("dialogs.confirm"));
  const cancelText = cancelLabel ?? t("common.cancel");

  function submit() {
    onConfirm(value.trim());
  }

  return (
    <Modal title={title} onClose={onCancel} size="sm" ariaLabel={title}>
      <div className="flex flex-col gap-3 p-4">
        {description && <p className="text-sm leading-relaxed text-secondary">{description}</p>}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          readOnly={readOnly}
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        <div className="flex justify-end gap-2 pt-1">
          {!readOnly && (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              {cancelText}
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={submit}>
            {confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
