/**
 * Headless channel-list embed.
 *
 * Renders the standalone {@link Sidebar} (channels + DMs + activity
 * triggers) inside its own `MemoryRouter` so the React-Router hooks
 * the sidebar uses internally (`useParams`, `useNavigate`,
 * `<Link>`) keep working without forcing the host to mount the
 * full `WorkspaceShell`. Hosts can drop this into their own chrome
 * (sub-sidebar, sheet, panel) and listen for navigation through the
 * `onNavigate` callback.
 *
 * The host is expected to wrap this in {@link CollabAiProvider}
 * (a.k.a. {@link AppProviders}) so the runtime config + auth + sync
 * stores are populated before the sidebar paints.
 */
import { MemoryRouter, Route, Routes } from "react-router";
import { Sidebar } from "../../web/src/components/Sidebar.tsx";
import { NavBridge } from "./internal/NavBridge.js";

export interface CollabAiChannelListProps {
  /** Active workspace; matches the JWT's `tid`. */
  workspaceId: string;
  /**
   * Called whenever the user clicks a channel / DM row. Path is
   * embed-relative (e.g. `/c/<channelId>`). The host is responsible
   * for translating it into a route push in its own outer router.
   */
  onNavigate?: (path: string) => void;
}

export function CollabAiChannelList({ workspaceId, onNavigate }: CollabAiChannelListProps) {
  const initialPath = `/w/${encodeURIComponent(workspaceId)}`;
  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <NavBridge
        onNavigate={onNavigate ? (path) => onNavigate(stripWorkspacePrefix(path, workspaceId)) : undefined}
      />
      <Routes>
        <Route path="/w/:workspaceId/*" element={<Sidebar />} />
      </Routes>
    </MemoryRouter>
  );
}

/**
 * The sidebar generates internal links of the form
 * `/w/<workspaceId>/c/<channelId>`. Hosts care about the in-workspace
 * suffix (`/c/<channelId>`), not the workspace prefix they already
 * supplied, so we strip it before forwarding through `onNavigate`.
 */
function stripWorkspacePrefix(path: string, workspaceId: string): string {
  const prefix = `/w/${encodeURIComponent(workspaceId)}`;
  if (path === prefix) return "/";
  if (path.startsWith(`${prefix}/`)) return path.slice(prefix.length);
  return path;
}
