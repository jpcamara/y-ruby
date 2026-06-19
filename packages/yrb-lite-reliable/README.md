# yrb-lite-reliable

The transport-agnostic **reliable-delivery core** for the
[`yrb-lite`](https://github.com/jpcamara/yrb-lite) y-websocket protocol — the
nuances a provider would otherwise re-implement, factored out so you can compose
them inside *your own* Yjs provider.

It owns:

- an **ack-tracked queue** of unacknowledged local updates,
- **"sync since last ack"** — the unacked tail is sent as one *merged*,
  causally-complete delta, so the server never sees an internal gap,
- **cumulative acks** — `{ ack: id }` confirms every update with `seq <= id`,
- **retransmit** on a timer with a **"server doesn't support acks" fallback**,
- **reconnect replay** of the unacked tail.

It does **not** touch any transport, Yjs document binding, awareness/presence, or
wire encoding. You inject `send` and `merge` and drive it from your provider's
lifecycle.

## Install

```bash
npm install yrb-lite-reliable
```

No dependencies. You supply `merge` (typically `Y.mergeUpdates` from `yjs`, which
your provider already has).

## API

```js
import { ReliableSync } from "yrb-lite-reliable";

const rs = new ReliableSync({
  // Transmit one update. `update` is the raw merged bytes; `id` is the
  // cumulative sequence (or undefined post-fallback). You frame + send it.
  send: (update, id) => { /* writeUpdate + base64 + put on your socket */ },
  // Merge an array of update byte-arrays into one (Y.mergeUpdates).
  merge: (updates) => Y.mergeUpdates(updates),
  resendInterval: 1000,        // ms between retransmits (default 1000)
  maxUnconfirmedResends: 8,    // resends with no ack before falling back
  onFallback: () => {},        // optional: called once if that fallback trips
});

rs.enqueue(update);  // a local document update (never a server echo)
rs.onAck(id);        // an { ack: id } frame arrived
rs.onConnect();      // transport (re)connected — replays the tail, starts retransmits
rs.onDisconnect();   // transport dropped — keeps the queue, pauses retransmits
rs.hasPending;       // are there unacknowledged updates?
rs.destroy();        // stop timers, drop the queue
```

## Composing it in a provider

```js
import { ReliableSync } from "yrb-lite-reliable";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import { writeUpdate } from "y-protocols/sync";

const MessageType = { Sync: 0 };
const toBase64 = (b) => btoa(String.fromCharCode(...b));

class MyProvider {
  constructor(doc, subscription) {
    this.doc = doc;
    this.subscription = subscription;

    this.reliable = new ReliableSync({
      merge: Y.mergeUpdates,
      send: (update, id) => {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MessageType.Sync);
        writeUpdate(enc, update);                    // frame it (provider's job)
        const payload = { update: toBase64(encoding.toUint8Array(enc)) };
        if (id !== undefined) payload.id = id;        // tag for the ack
        this.subscription.send(payload);              // transport (provider's job)
      },
    });

    // local edits -> queue (ignore updates we applied FROM the server)
    doc.on("update", (update, origin) => {
      if (origin !== this) this.reliable.enqueue(update);
    });
  }

  // wire these to your transport's callbacks:
  received(message) {
    if (message.ack !== undefined) return this.reliable.onAck(message.ack);
    /* ...decode + apply sync/awareness as usual... */
  }
  connected()    { /* send SyncStep1, then: */ this.reliable.onConnect(); }
  disconnected() { this.reliable.onDisconnect(); }
  destroy()      { this.reliable.destroy(); }
}
```

The server side (ack generation, gap detection) is the
[`yrb-lite-actioncable`](https://github.com/jpcamara/yrb-lite) gem's
`YrbLite::ActionCable::Sync`. This package is the client counterpart.

## License

MIT
