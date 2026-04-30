/**
 * Route prefix helper for the embedded-vs-standalone seam.
 *
 * The same React tree runs under two route mounts inside CollabAi's
 * BrowserRouter (see `packages/hofos-ui/src/collab-ai-host.tsx`):
 *
 *   <Route path="/w/:workspaceId/*" element={<WorkspaceShell />} />
 *   <Route path="/chat/*"           element={<WorkspaceShell />} />
 *
 * Standalone mode lands at `/` → `<Bootstrap>` redirects to
 * `/w/<workspaceId>`, so every render under WorkspaceShell sees
 * `useParams().workspaceId` set and can build URLs like
 * `/w/<wsid>/c/<channelId>`.
 *
 * Embedded mode (hof-os data-app) navigates the host directly to
 * `/chat` to keep the public URL contract from
 * `infra/sister-ui-contract.json`:
 *
 *   "hostRoutes": ["/chat", "/chat/c/:channelId", ...]
 *
 * On that branch `useParams().workspaceId` is **undefined**, so the
 * legacy pattern
 *
 *   `${params.workspaceId ? `/w/${params.workspaceId}` : ""}/c/${id}`
 *
 * collapses to bare `/c/<id>`. The browser navigates there, and
 * CollabAi's outer router has no route for `/c/*` — only `/`,
 * `/w/:workspaceId/*` and `/chat/*` — so react-router prints
 * "No routes matched location /c/<id>" and the channel pane renders
 * blank. The hof-os shell sees the URL change but the chat tree
 * itself shows nothing below the persistent sidebar.
 *
 * This helper picks the right prefix depending on which outer route
 * is currently active, so embedded navigation lands back on
 * `/chat/c/<id>` (which CollabAi's `/chat/*` route then matches and
 * renders ChannelPage for) rather than on bare `/c/<id>`.
 */
import { useLocation, useParams } from "react-router";

const EMBEDDED_HOST_ROOT = "/chat";

/**
 * Returns the URL prefix that should sit in front of `/c/<channelId>`
 * (and similar channel-scoped paths) for the current route mount.
 *
 * - `/w/<workspaceId>` when the user is under the standalone
 *   `/w/:workspaceId/*` route (e.g. `/w/default`, `/w/default/c/foo`).
 * - `/chat` when the user is under the embedded `/chat/*` route
 *   (the hof-os public URL contract).
 * - `""` for the brief boot window before either route has matched.
 *
 * Always rebuild full hrefs as `${useChannelRoutePrefix()}/c/<id>` so
 * the inner router never sees bare `/c/<id>`.
 */
export function useChannelRoutePrefix(): string {
  const params = useParams<{ workspaceId?: string }>();
  const location = useLocation();
  if (params.workspaceId) return `/w/${params.workspaceId}`;
  if (location.pathname === EMBEDDED_HOST_ROOT || location.pathname.startsWith(`${EMBEDDED_HOST_ROOT}/`)) {
    return EMBEDDED_HOST_ROOT;
  }
  return "";
}

/**
 * Returns the URL the "back to workspace home" / channel-deselect
 * affordance should navigate to. In embedded mode that's `/chat`
 * (host's persistent group entry); in standalone mode it's
 * `/w/<workspaceId>`. Falls back to `/` so Bootstrap can rerun.
 */
export function useWorkspaceHomeHref(): string {
  const params = useParams<{ workspaceId?: string }>();
  const location = useLocation();
  if (params.workspaceId) return `/w/${params.workspaceId}`;
  if (location.pathname === EMBEDDED_HOST_ROOT || location.pathname.startsWith(`${EMBEDDED_HOST_ROOT}/`)) {
    return EMBEDDED_HOST_ROOT;
  }
  return "/";
}
