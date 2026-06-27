// yrb-lite-decode — turn a stored Yjs CRDT state into readable content, with no
// Node runtime (compiled to a standalone executable with `bun build --compile`).
//
// The yrb-lite server stores opaque Yjs updates; it never understands document
// content. This binary is the "understanding" half: feed it the base64 CRDT
// state (what `GET /docs/:id/content` returns) and it reconstructs the document.
//
//   echo "<base64 state>" | yrb-lite-decode text
//   echo "<base64 state>" | yrb-lite-decode lexical-json --field lexxy-editor
//   yrb-lite-decode lexical-html --field lexxy-editor --state "<base64>"
//
// Modes:
//   text          plain text, Yjs-only (fast, editor-agnostic) — index/preview
//   lexical-json  full-fidelity Lexical EditorState JSON (headless Lexical)
//   lexical-html  HTML render of the Lexical document
//   lexical-text  Lexical's own text serialization
import * as Y from "yjs";

type Mode = "text" | "lexical-json" | "lexical-html" | "lexical-text";

function parseArgs(argv: string[]) {
  const [mode, ...rest] = argv;
  const opts: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) opts[rest[i].slice(2)] = rest[++i];
  }
  return { mode: mode as Mode, field: opts.field, state: opts.state };
}

async function readState(inline?: string): Promise<Uint8Array> {
  const b64 = (inline ?? (await Bun.stdin.text())).trim();
  return new Uint8Array(Buffer.from(b64, "base64"));
}

function docFrom(state: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc;
}

// --- Tier 1: plain text, Yjs-only -----------------------------------------
// Walks the shared types the editor stores content in (Lexical -> Y.XmlText,
// ProseMirror/Tiptap -> Y.XmlFragment, plain -> Y.Text) and concatenates the
// visible string runs. Format-agnostic and dependency-free beyond Yjs, so it's
// the fast path the gem uses for search indexing and previews.
function xmlToText(node: Y.XmlElement | Y.XmlText | Y.XmlFragment): string {
  if (node instanceof Y.XmlText) {
    return node
      .toDelta()
      .map((op: { insert: unknown }) => (typeof op.insert === "string" ? op.insert : "\n"))
      .join("");
  }
  let out = "";
  node.forEach((child: Y.XmlElement | Y.XmlText) => {
    out += xmlToText(child);
    if (child instanceof Y.XmlElement) out += "\n";
  });
  return out;
}

// Applying an update to a fresh doc leaves its root types UNTYPED (doc.share
// holds generic AbstractType until something accesses a root with a concrete
// constructor — the type isn't in the binary). So we can't introspect; we have
// to try each constructor. We do it on a fresh doc per attempt to avoid Yjs's
// "already defined with a different constructor" guard, and keep the richest
// (longest) text a candidate yields.
function readAs(state: Uint8Array, key: string, Ctor: typeof Y.XmlText | typeof Y.XmlFragment | typeof Y.Text): string {
  try {
    const doc = docFrom(state);
    const t = doc.get(key, Ctor as never);
    if (t instanceof Y.Text && !(t instanceof Y.XmlText)) return t.toString();
    return xmlToText(t as Y.XmlText | Y.XmlFragment);
  } catch {
    return "";
  }
}

function plainText(state: Uint8Array, field?: string): string {
  const keys = field ? [field] : [...(docFrom(state).share as Map<string, unknown>).keys()];
  const ctors = [Y.XmlText, Y.XmlFragment, Y.Text] as const;
  const parts: string[] = [];
  for (const key of keys) {
    let best = "";
    for (const Ctor of ctors) {
      const text = readAs(state, key, Ctor).trim();
      if (text.length > best.length) best = text;
    }
    if (best) parts.push(best);
  }
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// --- Tier 2: full-fidelity Lexical (headless) ------------------------------
// Binds a headless Lexical editor to the Yjs doc via @lexical/yjs and reads the
// reconstructed EditorState. This is the part that needs the Lexical packages;
// it mirrors what @lexical/react's CollaborationPlugin does in a browser, minus
// the DOM.
async function lexicalDecode(state: Uint8Array, field: string, want: "json" | "html" | "text") {
  const { createHeadlessEditor } = await import("@lexical/headless");
  const { createBinding, syncYjsChangesToLexical } = await import("@lexical/yjs");
  const { $getRoot } = await import("lexical");

  const editor = createHeadlessEditor({
    namespace: "yrb-lite-decode",
    nodes: [],
    onError: (e: unknown) => {
      throw e;
    },
  });

  // @lexical/yjs always keys the document under "root"; the id is just the
  // docMap handle and doesn't affect where content lives.
  const id = field || "root";
  const doc = new Y.Doc();
  const provider = stubProvider();
  const binding = createBinding(editor as never, provider, id, doc, new Map([[id, doc]]));

  // Observe the shared root and replay incoming Yjs changes into Lexical (the
  // same path @lexical/react's CollaborationPlugin uses to load an existing doc).
  binding.root.getSharedType().observeDeep((events: unknown[], transaction: { origin: unknown }) => {
    if (transaction.origin !== binding) {
      syncYjsChangesToLexical(binding as never, provider, events as never, false);
    }
  });

  Y.applyUpdate(doc, state);
  // syncYjsChangesToLexical schedules an editor.update; let it flush before read.
  await new Promise((r) => setTimeout(r, 0));

  if (want === "json") return JSON.stringify(editor.getEditorState().toJSON());
  if (want === "text") {
    let text = "";
    editor.getEditorState().read(() => {
      text = $getRoot().getTextContent();
    });
    return text;
  }
  // $generateHtmlFromNodes needs a DOM; @lexical/headless/dom supplies one.
  const { $generateHtmlFromNodes } = await import("@lexical/html");
  const { withDOM } = await import("@lexical/headless/dom");
  let html = "";
  editor.getEditorState().read(() => {
    html = withDOM(() => $generateHtmlFromNodes(editor as never, null));
  });
  return html;
}

// The sync functions only touch provider.awareness for cursors; a minimal stub
// suffices for content reconstruction.
function stubProvider() {
  const awareness = {
    getStates: () => new Map(),
    getLocalState: () => null,
    setLocalState: () => {},
    on: () => {},
    off: () => {},
    once: () => {},
    meta: new Map(),
    states: new Map(),
    clientID: 0,
    doc: null,
  };
  return { awareness, connect: () => {}, disconnect: () => {}, on: () => {}, off: () => {} } as never;
}

const { mode, field, state: inline } = parseArgs(Bun.argv.slice(2));
const state = await readState(inline);

let output: string;
switch (mode) {
  case "text":
    output = plainText(state, field);
    break;
  case "lexical-json":
    output = await lexicalDecode(state, field ?? "root", "json");
    break;
  case "lexical-html":
    output = await lexicalDecode(state, field ?? "root", "html");
    break;
  case "lexical-text":
    output = await lexicalDecode(state, field ?? "root", "text");
    break;
  default:
    console.error(`unknown mode: ${mode} (want: text | lexical-json | lexical-html | lexical-text)`);
    process.exit(2);
}
process.stdout.write(output);
