# yrb-lite-decode (Bun binary)

> Status: **working prototype** (uncommitted). All four modes verified
> end-to-end, including a Lexical round-trip with formatting — see *Status*.

The **opt-in, full-fidelity** half of decoding a stored Yjs document. Given a
base64 CRDT state (what `GET /docs/:id/content` returns), it reconstructs the
**exact Lexical document** — EditorState JSON or HTML — by binding a headless
Lexical editor to the doc via `@lexical/yjs`. Compiled with `bun build --compile`
into a single self-contained executable: **no Node, no `npm install` at runtime.**

```bash
echo "<base64 state>" | bin/yrb-lite-decode lexical-json --field lexxy-editor
echo "<base64 state>" | bin/yrb-lite-decode lexical-html --field lexxy-editor
echo "<base64 state>" | bin/yrb-lite-decode text          # plain text (also available)
```

## Where this fits

Decoding splits by cost/fidelity, and the two halves live in different places:

| Need | Use | Cost |
|------|-----|------|
| plain text — **indexing, previews** | the **`yrb-lite-decoder` gem** (pure Ruby, in-process) | ~5 µs/doc |
| exact Lexical EditorState / HTML — SSR, snapshots, migrations | **this binary** | ~40 ms/doc (subprocess) |

The common case (text) is pure Ruby on the core extension and needs none of
this. This binary is the heavyweight you reach for only when you need real
Lexical fidelity — so it's a separate package, not a dependency of the gem.

## Build

```bash
bun install && bun run build      # → bin/yrb-lite-decode
```

The binary is platform-specific (it embeds the Bun runtime, ~55 MB), so a release
ships per-platform — mirroring `.github/workflows/cross-gem.yml` for the core
extension, or built on-demand against the host app's own `@lexical/*`.

## Status — verified

- ✅ `lexical-json` / `lexical-html` / `lexical-text`: full-fidelity Lexical
  reconstruction. `src/roundtrip.ts` (run `bun run test`) builds a real Lexical
  document through `@lexical/yjs` headlessly, takes its CRDT state, decodes it
  back, and asserts the text **and formatting** survive (a bold node comes back
  with its format bit). HTML renders via `@lexical/headless/dom`'s `withDOM`
  (`<strong>` for bold).
- ✅ `text`: plain-text extraction (Lexical, ProseMirror, plain `Text`) — for
  Ruby callers prefer the gem; this mode is here for non-Ruby consumers.

Two things that had to line up, both now handled:
- `@lexical/yjs` keys the document under **`"root"`** (not the editor id), and
  decode needs an async flush after `applyUpdate` (the Yjs→Lexical sync schedules
  the editor update).
- Versions are pinned to lexxy's `@lexical/yjs@0.44.0`, **with lexxy's
  `CollabElementNode.splice` patch** (`patches/`) — required on the decode path,
  not just in the browser.

## Open questions

- Pin `@lexical/*` in the package (current), or build the binary against the host
  app's own `node_modules/@lexical` so fidelity always tracks the producer?
- Ship prebuilt per-platform binaries, or always build-on-deploy?
