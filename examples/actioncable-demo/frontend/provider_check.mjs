// Verifies the real @y-rb/actioncable WebsocketProvider works against the
// yrb-lite server. The provider's protocol logic (sync + awareness over an
// ActionCable subscription) is what we're checking; @rails/actioncable's
// browser-only transport doesn't deliver inbound messages headless, so we give
// the provider a tiny raw-WebSocket ActionCable consumer instead. In a real
// browser the standard createConsumer works — that's what the demo uses.
//
//   bin/rails s -p 3777
//   cd frontend && bun provider_check.mjs
import { createRequire } from "module"
const require = createRequire(import.meta.url)

// Share ONE yjs instance with the provider (it's CJS) — mixing ESM `import`
// loads a second yjs and breaks constructor checks.
const Y = require("yjs")
const { WebsocketProvider } = require("@y-rb/actioncable")

const PORT = process.env.PORT || 3777
const ROOM = `prov-${process.pid}`
const URL = `ws://localhost:${PORT}/cable`

// Minimal ActionCable consumer over a raw WebSocket (welcome -> subscribe;
// confirm_subscription -> connected; message -> received). Exactly the surface
// WebsocketProvider uses: consumer.subscriptions.create(params, mixin).
function rawConsumer(url) {
  const subs = []
  let welcomed = false
  const ws = new WebSocket(url, ["actioncable-v1-json"])
  const subscribe = (s) => ws.send(JSON.stringify({ command: "subscribe", identifier: s.identifier }))
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.type === "welcome") {
      welcomed = true
      subs.forEach(subscribe)
    } else if (msg.type === "confirm_subscription") {
      subs.find((s) => s.identifier === msg.identifier)?.connected?.()
    } else if (msg.message) {
      subs.find((s) => s.identifier === msg.identifier)?.received?.(msg.message)
    }
  }
  return {
    subscriptions: {
      create(params, mixin) {
        const identifier = JSON.stringify(params)
        const sub = Object.assign(
          {
            identifier,
            send(data) {
              ws.send(JSON.stringify({ command: "message", identifier, data: JSON.stringify(data) }))
              return true
            },
            unsubscribe() {
              ws.send(JSON.stringify({ command: "unsubscribe", identifier }))
            },
          },
          mixin
        )
        subs.push(sub)
        if (welcomed && ws.readyState === WebSocket.OPEN) subscribe(sub)
        return sub
      },
    },
    _ws: ws,
  }
}

let failures = 0
const check = (label, ok) => {
  console.log(`${ok ? "ok" : "FAIL"}: ${label}`)
  if (!ok) failures++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const waitFor = async (label, pred, ms = 5000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (pred()) return true
    await sleep(50)
  }
  check(`TIMEOUT: ${label}`, false)
  return false
}
const addParagraph = (doc, text) => {
  const frag = doc.getXmlFragment("default")
  doc.transact(() => {
    const p = new Y.XmlElement("paragraph")
    p.insert(0, [new Y.XmlText(text)])
    frag.insert(frag.length, [p])
  })
}
const text = (doc) => doc.getXmlFragment("default").toString()

const doc1 = new Y.Doc()
const doc2 = new Y.Doc()
const p1 = new WebsocketProvider(doc1, rawConsumer(URL), "DocumentChannel", { id: ROOM }, { disableBc: true })
const p2 = new WebsocketProvider(doc2, rawConsumer(URL), "DocumentChannel", { id: ROOM }, { disableBc: true })

await waitFor("both providers report synced", () => p1.synced && p2.synced)
check("both providers synced with the server", p1.synced && p2.synced)

addParagraph(doc1, "from provider one")
await waitFor("p2 receives p1's edit", () => text(doc2).includes("from provider one"))
check("document update propagated p1 -> p2", text(doc2).includes("from provider one"))

addParagraph(doc2, "from provider two")
await waitFor("p1 receives p2's edit", () => text(doc1).includes("from provider two"))
check("document update propagated p2 -> p1", text(doc1).includes("from provider two"))

p1.awareness.setLocalState({ user: { name: "PROVIDER-ONE" } })
await waitFor("p2 sees p1's presence", () =>
  [...p2.awareness.getStates().values()].some((s) => s.user?.name === "PROVIDER-ONE"))
check("awareness/presence propagated through the provider",
  [...p2.awareness.getStates().values()].some((s) => s.user?.name === "PROVIDER-ONE"))

await sleep(300)
const a = Y.encodeStateAsUpdate(doc1)
const b = Y.encodeStateAsUpdate(doc2)
check("documents converged byte-for-byte", a.length === b.length && a.every((x, i) => x === b[i]))

const doc3 = new Y.Doc()
const p3 = new WebsocketProvider(doc3, rawConsumer(URL), "DocumentChannel", { id: ROOM }, { disableBc: true })
await waitFor("late joiner catches up", () =>
  text(doc3).includes("from provider one") && text(doc3).includes("from provider two"))
check("a late joiner received the full document",
  text(doc3).includes("from provider one") && text(doc3).includes("from provider two"))

p1.destroy(); p2.destroy(); p3.destroy()
console.log("")
if (failures > 0) { console.log(`FAILED — ${failures} check(s) failed`); process.exit(1) }
console.log("PASS — the @y-rb/actioncable provider syncs through the yrb-lite server")
process.exit(0)
