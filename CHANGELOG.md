# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims
to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `yrb-lite-client`, the TypeScript client package for the yrb-lite
  ActionCable/AnyCable protocol. It provides `ActionCableProvider`,
  `YProtocolSession`, and the standalone `ReliableSync` delivery core.

### Changed

- Document delivery is ack-tracked by default in `yrb-lite-client`: document
  frames use `{ update, id }`, acknowledgements use `{ ack }`, and pending
  document updates stay queued until acked.
- The ActionCable protocol surface uses a single canonical document envelope:
  `{ "update" => "<base64 frame>" }`.
- AnyCable awareness/presence uses an awareness-only whisper envelope,
  `{ awareness: "<base64 awareness frame>" }`, while document frames stay on
  the server persistence/ack path.

### Fixed

- Incoming protocol frames are validated before mutating documents or awareness
  state, including trailing-byte rejection on the TypeScript client.
- Native/Rust protocol entry points reject wire client IDs that are unsafe for
  JavaScript clients.
- `lib0` is declared as a direct runtime dependency of `yrb-lite-client`.

## [0.1.0.beta5] - 2026-06-18

### Changed

- **Breaking:** the ActionCable integration has been extracted into a separate
  gem, [`yrb-lite-actioncable`](https://rubygems.org/gems/yrb-lite-actioncable).
  `yrb-lite` is now a standalone y-crdt wrapper: CRDT documents, awareness, and
  the y-websocket sync protocol primitives, with no Rails/ActionCable coupling
  (mirrors the `y-rb` / `yrb-actioncable` split). The `base64` runtime
  dependency moved with it.

### Migration

- Using `YrbLite::Sync`? Add `gem "yrb-lite-actioncable"` and change
  `include YrbLite::Sync` to `include YrbLite::ActionCable::Sync`. The concern's
  API is otherwise unchanged. If you only use `YrbLite::Doc`/`YrbLite::Awareness`,
  nothing changes.

## [0.1.0.beta4] - 2026-06-18

### Changed

- `on_change` block recorders now run in the **channel instance's context**
  (via `instance_exec`), so a recorder can call the channel's own methods --
  `current_user`, `params`, request/connection-scoped accessors -- directly,
  instead of plumbing them in through a thread-local. A non-Proc callable (an
  object responding to `#call`) is still invoked with `#call` and its own
  context. Existing block recorders that use
  only the `(key, update)` arguments and lexically-scoped constants are
  unaffected; the only behavioral change is `self` inside the block.

## [0.1.0.beta3] - 2026-06-18

### Changed

- Upgraded the bundled `yrs` (y-crdt) from 0.21 to 0.27.2. No change to the
  `YrbLite::Doc`, `YrbLite::Awareness`, or `YrbLite::Sync` public API; existing
  code and the wire protocol are unaffected.
- Thread-safety is preserved across the upgrade. yrs 0.27 dropped `Awareness`'s
  internal locking (its mutating methods now take `&mut self`, and `Awareness`
  is no longer `Sync`), so `YrbLite::Awareness` now serializes access through an
  internal `Mutex`. The lock is taken only while the GVL is released and is
  never held across the GVL boundary, so concurrent access from multiple Ruby
  threads stays safe and deadlock-free, and document reads still run in parallel
  (they operate on a cheaply-cloned, `Arc`-backed `Doc` handle, not under the
  presence lock).

### Build

- Building the gem from source now requires **Rust 1.94 or newer** (yrs 0.27.2
  uses `let`-chains). The precompiled platform gems are unaffected -- they need
  no Rust toolchain to install.

## [0.1.0.beta2] - 2026-06-16

### Added

- Reliable delivery (opt-in, client-driven). A client may tag a document update
  with an `"id"`; the server replies `{ "ack": <id> }` once the update has been
  durably recorded. This lets an
  ack-aware client retain and retransmit an update until delivery is confirmed,
  so an edit can't be silently lost on a flaky connection. Clients that omit
  `"id"` are still accepted, but their delivery is not ack-tracked.
- Demo coverage for reliable delivery with "sync-since-last-ack" framing (the
  unacknowledged tail is sent as one merged, causally-complete delta), plus a
  minimal reference client and an intensive message-loss stress test.

### Fixed

- Causal-gap protection. The authoritative, fast, and store paths now reject a
  document update that isn't causally ready -- one whose dependencies are
  missing because an earlier update was lost in transit or its durable record
  failed -- and ask the client to resync, instead of recording or relaying an
  un-integrable update that would leave the log permanently pending. Adds native
  `Doc#update_ready?`/`#pending?` (cheap, read-only checks) used to gate the
  record-before-distribute path.

## [0.1.0.beta1]

### Added

- Thread-safe `YrbLite::Doc` and `YrbLite::Awareness` over `yrs` (magnus/rb-sys
  native extension). The GVL is released during CRDT work so docs can run in
  parallel on MRI.
- `YrbLite::Sync` ActionCable channel concern implementing the y-websocket
  protocol (document sync plus awareness/presence).
- A "record-before-distribute" mode via an `on_change` hook, so every change is
  recorded durably before it's applied or relayed.
- Presence cleanup on disconnect, and idle-document eviction.
- Store-backed ActionCable delivery for AnyCable and multi-process use.
- Hardening against bad input: malformed or multi-message frames are dropped
  before processing or relay, and native panics are contained at the FFI
  boundary.
- Precompiled native gems for common platforms (no Rust toolchain needed to
  install) via the cross-gem workflow.

[Unreleased]: https://github.com/jpcamara/yrb-lite/compare/v0.1.0.beta5...main
[0.1.0.beta5]: https://github.com/jpcamara/yrb-lite/compare/v0.1.0.beta4...v0.1.0.beta5
[0.1.0.beta4]: https://github.com/jpcamara/yrb-lite/compare/v0.1.0.beta3...v0.1.0.beta4
[0.1.0.beta3]: https://github.com/jpcamara/yrb-lite/compare/v0.1.0.beta2...v0.1.0.beta3
[0.1.0.beta2]: https://github.com/jpcamara/yrb-lite/compare/v0.1.0.beta1...v0.1.0.beta2
[0.1.0.beta1]: https://github.com/jpcamara/yrb-lite/releases/tag/v0.1.0.beta1
