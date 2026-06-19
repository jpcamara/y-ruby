// A batteries-included client core for the yrb-lite y-websocket protocol.
//
// SyncEngine composes ReliableSync and additionally owns the parts a provider
// would otherwise re-implement: the y-protocols message framing (encode/decode),
// the sync-step handshake (SyncStep1 / SyncStep2 / Update), and awareness
// encode/apply. It binds to a Y.Doc (and optional Awareness) and speaks in raw
// Uint8Array frames -- you bring only the transport: base64 + the
// `{ update, id }` / `{ ack }` envelope and the socket.
//
// Drive it from your transport:
//   onConnect()          -> sends the opening handshake, replays the unacked tail
//   onDisconnect()       -> pauses retransmits, clears remote presence
//   ack(id)              -> a `{ ack: id }` envelope arrived
//   const reply = receive(frame)  -> a binary protocol frame arrived; send `reply` if non-null
// Local document edits and awareness changes are picked up automatically via the
// doc's / awareness's "update" events.
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { readSyncMessage, writeSyncStep1, writeUpdate, messageYjsSyncStep2 } from "y-protocols/sync";
import { encodeAwarenessUpdate, applyAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import { readAuthMessage } from "y-protocols/auth";
import { ReliableSync } from "./reliable_sync.js";

export const MessageType = { Sync: 0, Awareness: 1, Auth: 2, QueryAwareness: 3 };

export class SyncEngine {
  /**
   * @param {Y.Doc} doc
   * @param {object} opts
   * @param {(frame: Uint8Array, id: number|undefined) => void} opts.send
   *   transmit one raw protocol frame; `id` is set only for reliable document
   *   updates (tag it onto your envelope so the server can ack).
   * @param {import("y-protocols/awareness").Awareness} [opts.awareness]
   * @param {boolean} [opts.reliable=true] use ack-tracked reliable delivery
   * @param {number} [opts.resendInterval] forwarded to ReliableSync
   * @param {number} [opts.maxUnconfirmedResends] forwarded to ReliableSync
   * @param {() => void} [opts.onFallback] forwarded to ReliableSync
   */
  constructor(
    doc,
    {
      send,
      awareness = null,
      reliable = true,
      resendInterval,
      maxUnconfirmedResends,
      onFallback,
      setInterval: setIntervalFn,
      clearInterval: clearIntervalFn,
    } = {}
  ) {
    if (!doc) throw new TypeError("SyncEngine requires a Y.Doc");
    if (typeof send !== "function") throw new TypeError("SyncEngine requires a send(frame, id) function");

    this.doc = doc;
    this.awareness = awareness;
    this.reliable = reliable;
    this._send = send;
    this._synced = false;

    this._delivery = new ReliableSync({
      merge: Y.mergeUpdates,
      send: (update, id) => this._send(this._frameUpdate(update), id),
      resendInterval,
      maxUnconfirmedResends,
      onFallback,
      setInterval: setIntervalFn,
      clearInterval: clearIntervalFn,
    });

    this._onDocUpdate = (update, origin) => {
      if (origin === this) return; // applied from the server; don't echo it back
      if (this.reliable && this._delivery.reliable) this._delivery.enqueue(update);
      else this._send(this._frameUpdate(update), undefined);
    };
    this.doc.on("update", this._onDocUpdate);

    if (this.awareness) {
      this._onAwarenessUpdate = ({ added, updated, removed }) => {
        const changed = added.concat(updated, removed);
        this._send(this._frameAwareness(changed), undefined); // presence: fire-and-forget
      };
      this.awareness.on("update", this._onAwarenessUpdate);
    }
  }

  /** True once we've received the server's SyncStep2 (the document is caught up). */
  get synced() {
    return this._synced;
  }

  /** True while there are unacknowledged local document updates in flight. */
  get hasPending() {
    return this._delivery.hasPending;
  }

  /** Transport connected: send the opening handshake and replay the unacked tail. */
  onConnect() {
    this._send(this._frameSyncStep1(), undefined);
    if (this.awareness && this.awareness.getLocalState() !== null) {
      this._send(this._frameAwareness([this.doc.clientID]), undefined);
    }
    if (this.reliable) this._delivery.onConnect();
  }

  /** Transport dropped: pause retransmits (queue kept) and clear remote presence. */
  onDisconnect() {
    this._synced = false;
    this._delivery.onDisconnect();
    if (this.awareness) {
      const remote = [...this.awareness.getStates().keys()].filter((c) => c !== this.doc.clientID);
      if (remote.length) removeAwarenessStates(this.awareness, remote, this);
    }
  }

  /** A reliable-delivery `{ ack: id }` envelope arrived. */
  ack(id) {
    this._delivery.onAck(id);
  }

  /**
   * Decode and apply one incoming binary protocol frame (document sync, awareness,
   * query, or auth). Returns a reply frame to transmit (e.g. SyncStep2 answering a
   * SyncStep1, or an awareness reply to a query), or null if there's nothing to send.
   * @param {Uint8Array} frame
   * @returns {Uint8Array|null}
   */
  receive(frame) {
    const decoder = decoding.createDecoder(frame);
    const encoder = encoding.createEncoder();
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MessageType.Sync: {
        encoding.writeVarUint(encoder, MessageType.Sync);
        const syncType = readSyncMessage(decoder, encoder, this.doc, this);
        if (!this._synced && syncType === messageYjsSyncStep2) this._synced = true;
        break;
      }
      case MessageType.Awareness:
        if (this.awareness) applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), this);
        return null;
      case MessageType.QueryAwareness:
        if (!this.awareness) return null;
        encoding.writeVarUint(encoder, MessageType.Awareness);
        encoding.writeVarUint8Array(
          encoder,
          encodeAwarenessUpdate(this.awareness, [...this.awareness.getStates().keys()])
        );
        break;
      case MessageType.Auth:
        readAuthMessage(decoder, this.doc, (_doc, reason) => console.warn(`[yrb-lite] auth denied: ${reason}`));
        return null;
      default:
        return null;
    }
    return encoding.length(encoder) > 1 ? encoding.toUint8Array(encoder) : null;
  }

  /** Detach doc/awareness listeners and stop retransmits. */
  destroy() {
    this.doc.off("update", this._onDocUpdate);
    if (this.awareness && this._onAwarenessUpdate) this.awareness.off("update", this._onAwarenessUpdate);
    this._delivery.destroy();
  }

  _frameSyncStep1() {
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, MessageType.Sync);
    writeSyncStep1(e, this.doc);
    return encoding.toUint8Array(e);
  }

  _frameUpdate(update) {
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, MessageType.Sync);
    writeUpdate(e, update);
    return encoding.toUint8Array(e);
  }

  _frameAwareness(clients) {
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, MessageType.Awareness);
    encoding.writeVarUint8Array(e, encodeAwarenessUpdate(this.awareness, clients));
    return encoding.toUint8Array(e);
  }
}
