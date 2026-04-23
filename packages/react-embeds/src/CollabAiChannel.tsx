/**
 * Headless channel pane embed.
 *
 * Wraps the standalone {@link ChannelPage} (header + message list +
 * composer + drag-drop overlay) inside its own `MemoryRouter` so the
 * `useParams` / `useNavigate` hooks the page uses internally don't
 * collide with the host's outer router. Hosts mount this as the
 * primary content surface in their own chrome and supply the active
 * channel through `initialPath`.
 *
 * Like {@link CollabAiChannelList}, the host is expected to wrap
 * this in {@link CollabAiProvider} so runtime config + auth + sync
 * are already populated.
 */
import { MemoryRouter, Navigate, Route, Routes, useNavigate, useParams } from "react-router";
import { useEffect } from "react";
import { ChannelPage } from "../../web/src/pages/ChannelPage.tsx";
import { useAuth } from "../../web/src/state/auth.ts";
import { NavBridge } from "./internal/NavBridge.js";

export interface CollabAiChannelProps {
  /**
   * Initial channel-relative path, e.g. `/c/<channelId>`. Defaults
   * to `/` which renders an empty placeholder.
   */
  initialPath?: string;
  /**
   * Fires whenever the embed navigates internally (e.g. Cmd+K target,
   * unfurled link click). Path is channel-relative
   * (`/c/<channelId>`). The host translates this into its own router
   * push.
   */
  onNavigate?: (path: string) => void;
}

export function CollabAiChannel({ initialPath = "/", onNavigate }: CollabAiChannelProps) {
  const workspaceId = useAuth((s) => s.workspaceId);
  const wsSegment = workspaceId ? encodeURIComponent(workspaceId) : "_";
  const seed = `/w/${wsSegment}${initialPath === "/" ? "" : initialPath}`;
  return (
    <MemoryRouter initialEntries={[seed]}>
      <NavBridge
        onNavigate={onNavigate ? (path) => onNavigate(stripWorkspacePrefix(path, wsSegment)) : undefined}
      />
      <ChannelRouterSync initialPath={initialPath} workspaceSegment={wsSegment} />
      <Routes>
        <Route path="/w/:workspaceId" element={<EmptyChannelState />} />
        <Route path="/w/:workspaceId/c/:channelId" element={<ChannelPage />} />
        <Route path="*" element={<Navigate to={`/w/${wsSegment}`} replace />} />
      </Routes>
    </MemoryRouter>
  );
}

/**
 * Bridges host-driven `initialPath` changes (host swaps the active
 * channel) into the in-embed `MemoryRouter`. Without this the embed
 * would only see the `initialPath` from the very first mount and
 * subsequent host navigations would be ignored.
 */
function ChannelRouterSync({
  initialPath,
  workspaceSegment,
}: {
  initialPath: string;
  workspaceSegment: string;
}) {
  const navigate = useNavigate();
  const params = useParams<{ workspaceId: string; channelId?: string }>();
  useEffect(() => {
    const desired = `/w/${workspaceSegment}${initialPath === "/" ? "" : initialPath}`;
    const current = `/w/${workspaceSegment}${params.channelId ? `/c/${params.channelId}` : ""}`;
    if (desired !== current) navigate(desired, { replace: true });
  }, [initialPath, workspaceSegment, navigate, params.channelId]);
  return null;
}

function EmptyChannelState() {
  return (
    <div className="flex h-full min-h-0 w-full items-center justify-center text-sm text-tertiary">
      Pick a channel from the sidebar to start chatting.
    </div>
  );
}

function stripWorkspacePrefix(path: string, workspaceSegment: string): string {
  const prefix = `/w/${workspaceSegment}`;
  if (path === prefix) return "/";
  if (path.startsWith(`${prefix}/`)) return path.slice(prefix.length);
  return path;
}
