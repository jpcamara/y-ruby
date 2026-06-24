# Changelog — yrb-lite-decoder

All notable changes to the `yrb-lite-decoder` gem.

## [Unreleased]

### Added
- Initial scaffold. `YrbLite::Decoder` reconstructs plain text from a stored Yjs
  CRDT state **in pure Ruby**, in-process, on the core gem's native extension —
  no Node, no subprocess, no binary:
  - `text` — plain text (Lexical `Y.XmlText`, plain `Y.Text`, ProseMirror
    `Y.XmlFragment`), for search indexing and exports.
  - `preview` — a compact, truncated single-line preview for list UIs.
- Requires the core `Doc` content readers (`root_names`, `read_text`, `read_xml`).

Full-fidelity Lexical reconstruction (EditorState JSON / HTML) is intentionally
**not** in this gem; it's the separate, opt-in `yrb-lite-decode` Bun binary (see
`packages/yrb-lite-decode`).
