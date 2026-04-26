/**
 * Mounts the toast viewport and routes WS-delivered notifications to
 * the in-app toast queue.
 *
 * - `useToasts` is the canonical store; any component can `push()` to
 *   surface ephemeral feedback (link copied, message saved, …).
 * - This host also subscribes to the `notifications` slice of `useSync`
 *   and shows a toast for each *new, unread* notification with a "Jump"
 *   action that navigates to the source message and marks it read.
 */
import { Toast, ToastViewport } from "@collabai/ui";
import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router";
import { useTranslator } from "../lib/i18n/index.ts";
import { callFunction } from "../lib/api.ts";
import { useSync, type NotificationRow } from "../state/sync.ts";
import { useToasts } from "../state/toasts.ts";

export function ToastHost() {
  const items = useToasts((s) => s.items);
  const dismiss = useToasts((s) => s.dismiss);
  const push = useToasts((s) => s.push);
  const setRead = useSync((s) => s.setNotificationRead);
  const params = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslator();
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    const unsub = useSync.subscribe((state, prev) => {
      if (state.notifications === prev.notifications) return;
      for (const n of Object.values(state.notifications) as NotificationRow[]) {
        if (n.read) continue;
        if (seen.current.has(n.id)) continue;
        seen.current.add(n.id);
        push({
          title: titleForKind(n.kind, t),
          description: n.body ?? undefined,
          tone: "info",
          durationMs: 6000,
          action: n.channel_id
            ? {
                label: t("toasts.jump"),
                onClick: () => {
                  const anchor = n.target_event_id ? `#message-${n.target_event_id}` : "";
                  navigate(
                    `${params.workspaceId ? `/w/${params.workspaceId}` : ""}/c/${n.channel_id}${anchor}`
                  );
                  void callFunction("notifications:mark-read", {
                    notification_id: n.id,
                  }).catch(() => undefined);
                  setRead(n.id);
                },
              }
            : undefined,
        });
      }
    });
    return unsub;
  }, [push, navigate, params.workspaceId, setRead, t]);

  return (
    <ToastViewport>
      {items.map((it) => (
        <Toast
          key={it.id}
          title={it.title}
          description={it.description}
          tone={it.tone}
          action={it.action}
          onDismiss={() => dismiss(it.id)}
        />
      ))}
    </ToastViewport>
  );
}

function titleForKind(kind: string, t: (k: string) => string): string {
  switch (kind) {
    case "mention":
      return t("toasts.mention");
    case "reaction":
      return t("toasts.reaction");
    case "reply":
    case "thread":
      return t("toasts.reply");
    case "invite":
      return t("toasts.invite");
    default:
      return t("toasts.notification");
  }
}
