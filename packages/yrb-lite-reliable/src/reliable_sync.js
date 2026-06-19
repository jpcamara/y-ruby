// Transport-agnostic reliable-delivery core for the yrb-lite y-websocket
// protocol. This owns the "nuances" a provider would otherwise re-implement:
// an ack-tracked queue of unacknowledged local updates, "sync since last ack"
// (the unacked tail is sent as one MERGED, causally-complete delta so the server
// never sees an internal gap), cumulative acks, periodic retransmit with a
// "server doesn't support acks" fallback, and reconnect replay.
//
// It does NOT touch any transport, Yjs binding, or wire encoding. You inject:
//   - send(update, id):  transmit one update. `update` is the raw merged update
//                        bytes; `id` is the cumulative sequence (or undefined,
//                        post-fallback). Frame + base64 + put it on your socket.
//   - merge(updates):    merge an array of update byte-arrays into one
//                        (typically Y.mergeUpdates from yjs).
// and you drive it from your provider's lifecycle:
//   - enqueue(update)         on every local document update (not server echoes)
//   - onAck(id)               when an { ack: id } frame arrives
//   - onConnect()/onDisconnect()  on transport (re)connect / drop
//
// Awareness/presence is intentionally out of scope -- it stays fire-and-forget
// in the provider.

const DEFAULTS = { resendInterval: 1000, maxUnconfirmedResends: 8 };

export class ReliableSync {
  /**
   * @param {object} opts
   * @param {(update: Uint8Array, id: number|undefined) => void} opts.send
   * @param {(updates: Uint8Array[]) => Uint8Array} opts.merge
   * @param {number} [opts.resendInterval=1000] ms between retransmits
   * @param {number} [opts.maxUnconfirmedResends=8] resends with no ack before
   *   deciding the server doesn't support reliable delivery and falling back
   * @param {() => void} [opts.onFallback] called once if that fallback trips
   * @param {(fn: () => void, ms: number) => any} [opts.setInterval]
   * @param {(handle: any) => void} [opts.clearInterval]
   */
  constructor({
    send,
    merge,
    resendInterval = DEFAULTS.resendInterval,
    maxUnconfirmedResends = DEFAULTS.maxUnconfirmedResends,
    onFallback,
    setInterval: setIntervalFn,
    clearInterval: clearIntervalFn,
  } = {}) {
    if (typeof send !== "function") throw new TypeError("ReliableSync requires a send(update, id) function");
    if (typeof merge !== "function") throw new TypeError("ReliableSync requires a merge(updates) function");

    this._send = send;
    this._merge = merge;
    this.resendInterval = resendInterval;
    this.maxUnconfirmedResends = maxUnconfirmedResends;
    this._onFallback = onFallback;
    // Injectable timer hooks make the resend loop testable; default to globals.
    this._setInterval = setIntervalFn || ((fn, ms) => setInterval(fn, ms));
    this._clearInterval = clearIntervalFn || ((h) => clearInterval(h));

    this.reliable = true; // flips false after the no-ack fallback
    this.pending = []; // unacked local updates: [{ seq, update }], in order
    this.nextSeq = 1;
    this.everAcked = false;
    this._resendsSinceProgress = 0;
    this._connected = false;
    this._timer = undefined;
  }

  /** True while there are unacknowledged local updates. */
  get hasPending() {
    return this.pending.length > 0;
  }

  /**
   * Record a local document update. While reliable, it's queued and the unacked
   * tail is flushed; once we've fallen back, it's sent fire-and-forget.
   * @param {Uint8Array} update
   */
  enqueue(update) {
    if (!this.reliable) {
      this._send(update, undefined);
      return;
    }
    this.pending.push({ seq: this.nextSeq++, update });
    this.flush();
  }

  /**
   * Send the whole unacked tail as one merged delta. The id is the highest seq
   * in the batch, so a single { ack } cumulatively confirms everything up to it.
   * No-op while disconnected (the tail is replayed on the next onConnect).
   */
  flush() {
    if (!this._connected || this.pending.length === 0) return;
    const updates = this.pending.map((p) => p.update);
    const merged = updates.length === 1 ? updates[0] : this._merge(updates);
    const id = this.pending[this.pending.length - 1].seq;
    this._send(merged, id);
  }

  /**
   * Confirm delivery up to `id`: prune every queued update with seq <= id.
   * @param {number} id
   */
  onAck(id) {
    this.everAcked = true;
    this._resendsSinceProgress = 0;
    this.pending = this.pending.filter((p) => p.seq > id);
  }

  /** Transport (re)connected: replay the unacked tail and resume retransmits. */
  onConnect() {
    this._connected = true;
    this.flush();
    this._startTimer();
  }

  /** Transport dropped: keep the queue (for reconnect replay), pause the timer. */
  onDisconnect() {
    this._connected = false;
    this._stopTimer();
  }

  /**
   * One retransmit tick. Exposed for deterministic testing; normally driven by
   * the internal timer. If we keep resending on a live connection and never get
   * an ack, the server doesn't support reliable delivery, so fall back to
   * fire-and-forget (and stop tracking, since idempotent CRDT sync covers it).
   */
  onTick() {
    if (!this._connected || this.pending.length === 0) return;
    if (!this.everAcked && ++this._resendsSinceProgress > this.maxUnconfirmedResends) {
      this.reliable = false;
      this.pending = [];
      this._stopTimer();
      this._onFallback?.();
      return;
    }
    this.flush();
  }

  /** Stop timers and drop references. Call when the provider is destroyed. */
  destroy() {
    this._stopTimer();
    this.pending = [];
  }

  _startTimer() {
    if (this._timer || !this.reliable) return;
    this._timer = this._setInterval(() => this.onTick(), this.resendInterval);
    if (this._timer && typeof this._timer.unref === "function") this._timer.unref();
  }

  _stopTimer() {
    if (this._timer !== undefined) this._clearInterval(this._timer);
    this._timer = undefined;
  }
}
