# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims
to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0.beta4] - 2026-06-18

### Changed

- `on_change` block recorders now run in the **channel instance's context**
  (via `instance_exec`), so a recorder can call the channel's own methods --
  `current_user`, `params`, request/connection-scoped accessors -- directly,
  instead of plumbing them in through a thread-local. A non-Proc callable (an
  object responding to `#call`) is still invoked with `#call` and its own
  context. `on_load`/`on_save` are unchanged: they can run in the shared
  document registry during a cold load or eviction, where no connection
  instance exists, so they remain key-only. Existing block recorders that use
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
  accepted (recorded in audit mode, applied in fast mode). This lets an
  ack-aware client retain and retransmit an update until delivery is confirmed,
  so an edit can't be silently lost on a flaky connection. Stock clients send no
  `"id"`, never get acks, and behave exactly as before.
- A vendored, ack-aware `@y-rb/actioncable` provider in the demo
  (`reliable_actioncable_provider.mjs`) that adds reliable delivery with
  "sync-since-last-ack" framing (the unacknowledged tail is sent as one merged,
  causally-complete delta), plus a minimal reference client and an intensive
  message-loss stress test.

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
  protocol (document sync plus awareness/presence). It's wire-compatible with
  the [`@y-rb/actioncable`](https://www.npmjs.com/package/@y-rb/actioncable)
  browser provider, and accepts its `{ update: ... }` envelope and `{ m: ... }`.
- A "record-before-distribute" mode via an `on_change` hook, so every change is
  recorded durably before it's applied or relayed.
- Presence cleanup on disconnect, and idle-document eviction.
- Two backends: `sync_backend :memory` (default, classic ActionCable) and
  `sync_backend :store` (stateless, AnyCable-ready, multi-process).
- Hardening against bad input: malformed or multi-message frames are dropped
  before processing or relay, and native panics are contained at the FFI
  boundary.
- Precompiled native gems for common platforms (no Rust toolchain needed to
  install) via the cross-gem workflow.

[Unreleased]: https://github.com/jpcamara/yrb-lite/compare/v0.1.0.beta4...main
[0.1.0.beta4]: https://github.com/jpcamara/yrb-lite/compare/v0.1.0.beta3...v0.1.0.beta4
[0.1.0.beta3]: https://github.com/jpcamara/yrb-lite/compare/v0.1.0.beta2...v0.1.0.beta3
[0.1.0.beta2]: https://github.com/jpcamara/yrb-lite/compare/v0.1.0.beta1...v0.1.0.beta2
[0.1.0.beta1]: https://github.com/jpcamara/yrb-lite/releases/tag/v0.1.0.beta1
