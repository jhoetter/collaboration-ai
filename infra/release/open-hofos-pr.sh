#!/usr/bin/env bash
# Opens (or refreshes) a PR against jhoetter/hof-os bumping
# infra/collabai.lock.json. Mirrors the office-ai bump bot.
#
# Required env:
#   GH_TOKEN     — token with `repo` scope on jhoetter/hof-os
#   VERSION      — e.g. "0.4.1"
#   IMAGE_REF    — e.g. "ghcr.io/jhoetter/collaboration-ai:0.4.1"
#   REPO         — current repo full name, e.g. "jhoetter/collaboration-ai"
#   SHA          — commit sha that produced this release
set -euo pipefail

: "${GH_TOKEN:?}"
: "${VERSION:?}"
: "${IMAGE_REF:?}"
: "${REPO:?}"
: "${SHA:?}"

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

cd "${WORK}"
git config --global user.email "collabai-bump@users.noreply.github.com"
git config --global user.name  "collabai-bump"
git clone "https://x-access-token:${GH_TOKEN}@github.com/jhoetter/hof-os.git" hof-os
cd hof-os
git checkout -b "collabai/bump-${VERSION}"

mkdir -p infra
cat > infra/collabai.lock.json <<JSON
{
  "version": "${VERSION}",
  "app_image": "${IMAGE_REF}",
  "app_image_tarball": "https://github.com/${REPO}/releases/download/v${VERSION}/collabai-app-${VERSION}.tar",
  "agent_version": "${VERSION}",
  "agent_tarball": "https://github.com/${REPO}/releases/download/v${VERSION}/collabai-agent-${VERSION}.tgz",
  "react_embeds_version": "${VERSION}",
  "react_embeds_tarball": "https://github.com/${REPO}/releases/download/v${VERSION}/collabai-react-embeds-${VERSION}.tgz",
  "published_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "source_repo": "${REPO}",
  "source_sha": "${SHA}"
}
JSON

git add infra/collabai.lock.json
git commit -m "chore(collabai): bump to v${VERSION}"
git push --force --set-upstream origin "collabai/bump-${VERSION}"

gh pr create \
  --repo jhoetter/hof-os \
  --base main \
  --head "collabai/bump-${VERSION}" \
  --title "chore(collabai): bump to v${VERSION}" \
  --body "Automated bump of \`infra/collabai.lock.json\` to **v${VERSION}**.

- Source: ${REPO}@${SHA}
- App image: \`${IMAGE_REF}\`
- Agent CLI tarball, React embeds tarball, and app image tarball
  are attached to the upstream release.

Once merged, the data-app rebuild will pick up the new React embeds via
\`ensure-collabai-react-embeds.cjs\` and the sandbox / sidecar images
will pick up the new \`agent_version\` / \`app_image\` on the next deploy." \
  || echo "PR already exists; pushed update."
