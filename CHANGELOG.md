# @kernhq/module-chat

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
