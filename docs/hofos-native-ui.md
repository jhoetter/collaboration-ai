# hofOS native UI workflow

CollabAI no longer publishes a standalone React embed bundle for hofOS.
The browser surface is developed here, checked in a hofOS-mode harness,
and exported as runtime source for `hof-os`.

## Contract

`hofos-ui.config.json` points to `../hof-os/infra/sister-ui-contract.json`.
That contract defines the host routes, `/api/chat` proxy prefix,
dependency compatibility rules, source export folders, and files hofOS
must preserve during import.

Run the gate before exporting:

```sh
pnpm run hofos:check
```

The gate fails on unapproved major-version dependency skew and checks
that the hofOS-mode harness covers these routes:

- `/chat`
- `/chat/c/example`
- `/chat/c/example?thread=example-message`

Known temporary warnings for Lexical, SimpleWebAuthn, and Tailwind are
declared in the hofOS contract. They are not hidden; remove those
allowances once the sibling harness matches hofOS.

## Harness

The required hofOS-mode harness command is:

```sh
pnpm run hofos:harness
```

The harness must use the same content constraints as hofOS: natural
`/chat/...` URLs without `/w/default`, the `/api/chat` proxy base,
runtime config from the host environment, and the shared Office-AI
attachment/editor contract.

## Live hofOS Development

For integrated UI work, run hofOS with the CollabAI product runtime
aliases pointed at this checkout:

```sh
cd ../hof-os
HOF_SISTER_UI_OVERLAY=1 COLLABAI_UI_SOURCE_PATH=$HOME/repos/collaboration-ai make dev
```

hofOS still owns the bridge files, auth, proxy, URL state, Assets/S3, and
Office-AI capabilities. This repo owns the product runtime source that is
exported into `modules/collabai/ui/original` and `ui/vendor`.

## Export

Create a deterministic source export:

```sh
pnpm run export:hofos-ui
```

The export lands under `release-out/hofos-ui/collabai-ui-source/` with:

- `files/` containing only runtime source for `ui/original` and `ui/vendor`
- `hofos-ui-export-manifest.json` with source SHA, route contract, exported paths, and contract hash

Import it in `hof-os`:

```sh
cd ../hof-os
pnpm --dir packages/hof-components import:sister-ui ../collaboration-ai/release-out/hofos-ui/collabai-ui-source
python packages/hof-components/setup.py --app data-app --starter hofos
npm --prefix packages/hof-components/data-app/ui run build
```

The import script replaces only exported runtime folders and preserves
hofOS bridge files such as `ui/pages`, `ui/lib`, `module.json`, and the
module README.
