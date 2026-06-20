// Zero-dependency reliable-delivery core. Safe to import on its own.
export { ReliableSync } from "./reliable_sync.js";
export type { ReliableSyncOptions, TimerHandle } from "./reliable_sync.js";

// Batteries-included protocol client (sync steps + encode/decode + awareness).
// Requires `yjs` and `y-protocols` as peers.
export { SyncEngine, MessageType } from "./sync_engine.js";
export type { SyncEngineOptions, SendOptions } from "./sync_engine.js";

// Ready-made ActionCable / AnyCable provider built on SyncEngine (with awareness
// whisper support). Bring your own provider instead by composing SyncEngine.
export { ActionCableProvider } from "./actioncable_provider.js";
export type { ActionCableProviderOptions, CableConsumer, CableSubscription } from "./actioncable_provider.js";

// Optional base64 helpers for transports that carry frames as strings.
export { toBase64, fromBase64 } from "./base64.js";
