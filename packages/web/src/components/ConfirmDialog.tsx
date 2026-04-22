/**
 * Modal confirm dialog — drop-in replacement for `window.confirm` /
 * `window.alert`. Mirrors the `ConfirmDialog` pattern used in
 * `~/repos/hof-os` but built on top of `@collabai/ui`'s shared `Modal`
 * so it inherits the chat surface's design tokens (border, card, shadow,
 * dark-mode handling).
 *
 * The component is purely presentational. Use the {@link useDialogs}
 * hook from `../lib/dialogs.tsx` to get a Promise-based imperative
 * `confirm(...)` API at call sites.
 */
import { Button, Modal } from "@collabai/ui";
import { useTranslator } from "../lib/i18n/index.ts";

export interface ConfirmDialogProps {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Label on the confirm button while {@link busy} is true. Defaults to "Working…". */
  busyLabel?: string;
  /** Use the destructive button variant for the confirm action (default: `false`). */
  destructive?: boolean;
  /** Disables both buttons and shows {@link busyLabel} on confirm. */
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel,
  busyLabel,
  destructive = false,
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const { t } = useTranslator();
  const confirmText = confirmLabel ?? t("dialogs.confirm");
  const cancelText = cancelLabel ?? t("common.cancel");
  const busyText = busyLabel ?? t("dialogs.busy");

  return (
    <Modal
      title={title}
      onClose={busy ? () => undefined : onCancel}
      size="sm"
      ariaLabel={title}
    >
      <div className="flex flex-col gap-4 p-4">
        {description && (
          <p className="text-sm leading-relaxed text-secondary">{description}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            {cancelText}
          </Button>
          <Button
            variant={destructive ? "danger" : "primary"}
            size="sm"
            onClick={() => void onConfirm()}
            disabled={busy}
            autoFocus
          >
            {busy ? busyText : confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
