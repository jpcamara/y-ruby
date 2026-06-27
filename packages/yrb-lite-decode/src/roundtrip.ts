// Proves the full-fidelity path: build a real Lexical document through
// @lexical/yjs headlessly, take its CRDT state, decode it back through the same
// binding, and check the reconstruction matches. Run: bun src/roundtrip.ts
import * as Y from "yjs";
import { createHeadlessEditor } from "@lexical/headless";
import {
  createBinding,
  syncLexicalUpdateToYjs,
  syncYjsChangesToLexical,
  type Provider,
} from "@lexical/yjs";
import { $getRoot, $createParagraphNode, $createTextNode } from "lexical";

const ID = "lexxy-editor";

// The sync functions only touch provider.awareness for cursors; a minimal stub
// is enough for content sync.
function stubProvider(): Provider {
  const awareness = {
    getStates: () => new Map(),
    getLocalState: () => null,
    setLocalState: () => {},
    on: () => {},
    off: () => {},
    once: () => {},
    destroy: () => {},
    meta: new Map(),
    states: new Map(),
    clientID: 0,
    doc: null,
  };
  return {
    awareness,
    connect: () => {},
    disconnect: () => {},
    on: () => {},
    off: () => {},
  } as unknown as Provider;
}

function newEditor() {
  return createHeadlessEditor({
    namespace: "yrb-lite-decode",
    nodes: [],
    onError: (e) => {
      throw e;
    },
  });
}

// --- PRODUCE: write a Lexical doc and flush it into a Y.Doc -----------------
function produce(): Uint8Array {
  const editor = newEditor();
  const doc = new Y.Doc();
  const provider = stubProvider();
  const binding = createBinding(editor, provider, ID, doc, new Map([[ID, doc]]));

  editor.registerUpdateListener(
    ({ prevEditorState, editorState, dirtyElements, dirtyLeaves, normalizedNodes, tags }) => {
      doc.transact(() => {
        syncLexicalUpdateToYjs(
          binding,
          provider,
          prevEditorState,
          editorState,
          dirtyElements,
          dirtyLeaves,
          normalizedNodes,
          tags,
        );
      }, binding);
    },
  );

  editor.update(
    () => {
      const root = $getRoot();
      const p1 = $createParagraphNode();
      p1.append($createTextNode("Hello, fidelity!"));
      const p2 = $createParagraphNode();
      p2.append($createTextNode("second "));
      const bold = $createTextNode("bold");
      bold.toggleFormat("bold");
      p2.append(bold);
      root.append(p1, p2);
    },
    { discrete: true },
  );

  return Y.encodeStateAsUpdate(doc);
}

// --- DECODE: load the CRDT state back into a fresh Lexical editor -----------
async function decode(state: Uint8Array): Promise<{ json: unknown; text: string }> {
  const editor = newEditor();
  const doc = new Y.Doc();
  const provider = stubProvider();
  const binding = createBinding(editor, provider, ID, doc, new Map([[ID, doc]]));

  const shared = binding.root.getSharedType();
  shared.observeDeep((events, transaction) => {
    if (transaction.origin !== binding) {
      syncYjsChangesToLexical(binding, provider, events, false);
    }
  });

  Y.applyUpdate(doc, state);
  // syncYjsChangesToLexical schedules editor.update; let it flush before we read.
  await new Promise((r) => setTimeout(r, 0));

  let text = "";
  editor.getEditorState().read(() => {
    text = $getRoot().getTextContent();
  });
  return { json: editor.getEditorState().toJSON(), text };
}

const state = produce();
const { json, text } = await decode(state);

const expectedText = "Hello, fidelity!\n\nsecond bold";
// The bold node must survive the round-trip (format bit === 1).
const root = (json as { root: { children: { children: { text: string; format: number }[] }[] } }).root;
const boldNode = root.children.flatMap((p) => p.children).find((n) => n.text === "bold");

const ok = text === expectedText && boldNode?.format === 1;
console.log("decoded text:", JSON.stringify(text));
console.log("bold node format bit:", boldNode?.format);
console.log(ok ? "PASS: round-trip text + formatting match" : `FAIL: text=${JSON.stringify(text)} bold=${boldNode?.format}`);
process.exit(ok ? 0 : 1);
