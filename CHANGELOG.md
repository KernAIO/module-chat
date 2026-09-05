# @kernhq/module-chat

## 0.5.0

### Minor Changes

- ca447a2: Incoming webhooks are gone: the `chat.webhooks.incoming` procedure, the `POST
/api/chat/webhooks/{token}` route and the `mod_chat.webhooks` table. Nothing could ever create a
  token — the only thing that ever named a `chat.webhooks.create` procedure was the comment above the
  table, written in the commit that added it — so there was no procedure, no insert and no screen, and
  the endpoint could only ever answer 404 against a permanently empty table. It was a feature nobody
  could turn on, advertised in the module's OpenAPI document (38 paths before, 37 after). Dropping the
  table loses no data on any instance, and `0001_drop_webhooks.sql` is guarded with `if exists` so the
  folder still survives a replay. Incoming webhooks can come back as a real feature — create, list and
  revoke, with a screen to manage the tokens.

### Patch Changes

- c892f45: The conversation header no longer carries a Huddle button. Calls are not built, so the button was
  permanently disabled on the busiest screen in the product — in every channel and every direct
  message, for everybody — and its only explanation was a `title` on a natively disabled button,
  which nothing can reach: a disabled button is out of the tab order and receives no pointer events,
  so neither a keyboard nor a screen reader nor a hover ever got the reason. It comes back when calls
  do.
- 02bae7a: The command palette's "New channel" opens the dialog. It runs `/chat?new=1`, because a command can
  only navigate — and nothing read that parameter, so the command moved you to the chat page and
  stopped there. The sidebar consumes it now and puts the URL back without it, so running the command
  again after closing the dialog opens it again.
- 9f8a3d7: Peer and develop against `@kernhq/kernel` ^0.10.0. A caret on 0.x does not cross a minor, so the
  previous `^0.9.1` could no longer reach the published framework — invisible locally, where the
  workspace copy is linked, and a lint failure in CI, which installs from the registry.
- 1100063: Archiving a private channel no longer announces it to the whole workspace. `realtime.change`
  publishes on the workspace channel, which every socket subscribes to for every workspace it belongs
  to the moment it authenticates — so archiving or restoring a private, object or group channel told
  everybody in the workspace that the channel exists and what had just happened to it, whether or not
  they may open it. The change now goes to the channel's own members, the same audience a private
  channel's creation already used, and `announce.test.ts` asserts the frames.
- b4a1a17: The composer's voice and video buttons say why they cannot record. They were disabled whenever the
  browser has no `MediaRecorder` — which is also every instance served over plain HTTP, where
  `navigator.mediaDevices` is absent — and a disabled button explains nothing to a pointer, a keyboard
  or a screen reader. Pressing one now opens the recorder bar on its "this browser cannot record"
  message, which was written and translated but could never be reached.
- 800cdb2: A row in the unread-chat widget opens its conversation. It linked to `/<ws>/chat?channel=<id>`
  while the chat page reads `?c=`, so every row on the dashboard landed on chat with nothing selected
  and the "pick a conversation" empty state.

## 0.4.16

### Patch Changes

- chore(deps): take @kernhq/testing ^0.1.12, which has permissionMatrixDiff

## 0.4.15

### Patch Changes

- c5a5b5d: The migration folder survives being applied twice. `0000_init.sql` created every table, index and
  policy without a guard, so a replay — which drizzle performs the moment any file in the folder is
  edited — threw on the first table and stopped the `chat` service, and the realtime gateway with
  it, from starting. Three tests now guard the module: the folder applied twice to a database created
  from nothing, a cross-tenant probe under a role that cannot bypass row-level security, and the
  permission matrix blessed in full.

## 0.4.14

### Patch Changes

- 435c8bb: The chat widget's "Rows" setting shows its label again instead of a raw message key; it now reads
  the shared `common.setting_rows` string like every other widget.

## 0.4.13

### Patch Changes

- 618de43: Peer @kernhq/kernel ^0.9.1 and @kernhq/ui ^0.14.0 — the framework published; the module's ranges follow so one install resolves a single consistent kernel.

## 0.4.12

### Patch Changes

- 6b9f8cb: Peer @kernhq/kernel ^0.9.1 — the framework published; the module's range follows so one install resolves a single consistent kernel.

## 0.4.11

### Patch Changes

- 95205e3: Reach the published `@kernhq/ui`, and refresh the lockfile the range edit invalidates.

  `^0.10.0` cannot install 0.12.5 — a caret on 0.x never crosses a minor — so a host resolving this
  module from the registry is told it needs a framework two minors behind the one every service runs.
  The lockfile moves in the same commit because `--frozen-lockfile` compares specifiers, so a range
  edit on its own fails install having built nothing.

## 0.4.10

### Patch Changes

- 97d052c: Declare the framework this is built against: `@kernhq/contracts@0.7.0`.

  `^0.6.1` cannot install 0.7.0 — a caret on 0.x never crosses a minor — so a host resolving this
  module from the registry would be told it needs a contracts two releases behind the one every
  service now runs. Typechecked against 0.7.0 in the workspace before the range moved, which is the
  only order that means anything: the umbrella pins contracts to `workspace:*`, so raising a range
  first and compiling second compiles against the old copy and proves nothing.

  The lockfile is refreshed in the same change, because `--frozen-lockfile` compares specifiers and
  a range edit alone fails install before anything is built.

## 0.4.9

### Patch Changes

- 59a621a: Reach the published framework, and refresh the lockfile that the range edit invalidated.

  `^0.9.0` cannot install `@kernhq/ui@0.10.0` — a caret on 0.x never crosses a minor — so a consumer
  installing this module from the registry resolved a framework it was not built against. Raising the
  range then leaves the committed `pnpm-lock.yaml` out of date with the manifest, and
  `--frozen-lockfile` compares specifiers, so the next publish dies at install having built nothing.
  Both halves are here because one without the other is not a fix.

  `scripts/check-ranges.mjs` now checks the lockfile as well, so the second half cannot be forgotten
  again — and checks this package's hosts against its peers, which `pnpm install` does not: pnpm 10
  resolved a `^0.6.1` peer against `contracts@0.5.2` and exited 0 without a warning.

## 0.4.8

### Patch Changes

- 176dfd5: fix: raise @kernhq ranges to what is published

  A caret on 0.x never crosses a minor, so `@kernhq/ui: ^0.8.0` and `@kernhq/contracts: ^0.5.1` could not install the published 0.9.0 and 0.6.1. Raised both to `^0.9.0` and `^0.6.1`.

## 0.4.7

### Patch Changes

- fix: declare @kernhq/kernel and @kernhq/contracts as peerDependencies

## 0.4.6

### Patch Changes

- chore: refresh the lockfile after the revert

## 0.4.5

### Patch Changes

- Merge remote-tracking branch 'origin/main'

## 0.4.4

### Patch Changes

- Merge remote-tracking branch 'origin/main'

## 0.4.3

### Patch Changes

- chore: refresh the lockfile for the service dependencies

## 0.4.2

### Patch Changes

- chore: refresh the lockfile for the changesets dependency

## 0.4.1

### Patch Changes

- fix(deps): reach the framework that was just published

## 0.4.0

### Minor Changes

- a265a67: Chat ships its own screens.

  The conversation page, fourteen components, two widgets, 121 strings in five locales, the mock and
  the API instance move into this package.

  Its half-written client i18n runtime is gone. It carried its own `t()`, its own bundle registry and
  its own `setChatLocale` — with `let locale = 'en'`, which was not reactive, so switching language
  would have left every chat string in the previous one. Nothing consumed it. The framework does this
  once now, for every module.

  `core-api.ts` names the slice of core's API chat calls — members, users and files — structurally, so
  chat does not import core's router type.

  Two cycles the move exposed, both of which compiled inside the app and could not have: `api-instance`
  and `store-instance` imported the package's own barrel, which re-exports them.

## 0.3.1

### Patch Changes

- 5137cc7: Report the version of the package the module ships in.

  The version in `defineModule` was a string literal, and nothing bumped it when changesets released
  the package: chat shipped as 0.2.0 and told every admin it was 0.1.0, and that literal is what the
  modules screen renders and what `workspace_modules.installed_version` records. It now comes from
  `packageVersion(import.meta.url)`, and `pnpm check:versions` fails the build if the two ever
  disagree again.

## 0.3.0

### Minor Changes

- 28d06b4: `ChatStore.runCommand` runs a slash command and keeps the rail honest afterwards. `commands.run` had
  a server and no caller, so typing `/leave` posted the word "/leave".

  It belongs on the store rather than in a composer because every command that does anything changes
  what the sidebar shows — `/leave` removes a channel, `/mute` changes a membership, `/topic` changes
  what the header reads. A message the command posts is applied immediately, so the sender sees their
  own `/shrug` without waiting for realtime.

  The `ephemeral` line comes back in the server's English; callers translate the commands they know
  and fall back to it for the rest, which keeps working when commands become pluggable.

## 0.2.1

### Patch Changes

- 2c3a896: Let a failed transcript recover, and stop following a channel you left.

  `openChannel` set the window to `loading: true` and awaited the request. When that request failed
  the window stayed loading for ever, so the reader watched a skeleton that would never become a
  conversation. `MessageWindow` now carries an `error`, a failed window is retried rather than treated
  as loaded, and `retryChannel` re-runs it.

  `leaveChannel` dropped the channel locally but kept its realtime subscription open, so messages kept
  arriving for a channel you were no longer in.

## 0.2.0

### Minor Changes

- 11091e2: Add the client entry point.

  `@kernhq/module-chat/client` exports what a host needs to draw a conversation without reimplementing
  any of it: the typed API client, the `ChatStore` (channels, sections, threads, reactions, pins,
  bookmarks, typing, presence, read state, and the realtime handler that keeps all of it current),
  message rendering helpers and the module's own message catalogue. The Svelte components live in the
  application, which owns the design system — the same split the tracker uses.

## 0.1.2

### Patch Changes

- 90f5fbc: Ship the sources the published client imports, and stop advertising a client that does not exist.

  0.1.1 fixed the unresolvable client by having it import its own package's entry points. That works
  for a consumer but not for the module repository itself, where the packages are type-checked before
  they are built — the entry points resolve to `dist`, which does not exist yet. The client goes back
  to relative imports and the tarball now carries `src/contract` (and `src/kql` for the tracker),
  which is what those imports point at.

  `@kernhq/module-chat` declared a `./client` export pointing at a file that was never written, so
  importing it always failed. The export is gone until the chat client lands.

  `pnpm check:pack` packs each module for real and walks every import from the published client entry,
  so neither can come back unnoticed.

## 0.1.1

### Patch Changes

- b6e9f16: Make the published client source resolvable.

  A module ships `src/client` as source so consumers build the Svelte components with their own
  toolchain, but that source imported `../contract/…` and `../kql/…` — paths under `src/` that the
  tarball does not contain. It worked in the development workspace, where the whole repository is
  linked, and failed in any real install with `Could not resolve '../kql/ast.js'`. The client now
  refers to its own package's entry points, the way any other consumer would, and those entries carry
  a `default` condition so resolvers that do not ask for `import` can find them too.
