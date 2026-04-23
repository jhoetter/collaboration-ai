/**
 * Slim "meeting in progress" banner shown at the top of the channel
 * pane while a huddle is live. Lets people who are in the channel —
 * but didn't see the original kickoff — discover and jump straight
 * into the call.
 */
import { Button, IconVideo } from "@collabai/ui";
import { useNavigate, useParams } from "react-router";
import { useTranslator } from "../../lib/i18n/index.ts";
import { useSync } from "../../state/sync.ts";

export function MeetingBanner({ channelId }: { channelId: string }) {
  const huddle = useSync((s) => s.huddlesByChannel[channelId]);
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const { t } = useTranslator();

  if (!huddle) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-accent/10 px-3 py-2 lg:px-4">
      <div className="flex min-w-0 items-center gap-2 text-sm text-foreground">
        <span className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-full bg-accent/20 text-accent">
          <IconVideo size={14} />
        </span>
        <span className="truncate">
          <span className="font-semibold">{t("channel.meetingInProgress")}</span>
          <span className="ml-2 text-tertiary">
            {t("meeting.participants", { n: huddle.participants.length })}
          </span>
        </span>
      </div>
      <Button
        variant="primary"
        size="sm"
        onClick={() => navigate(`/w/${workspaceId}/c/${channelId}/meet`)}
      >
        {t("channel.joinMeeting")}
      </Button>
    </div>
  );
}
