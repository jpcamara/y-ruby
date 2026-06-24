# frozen_string_literal: true

require "yrb_lite"
require "yrb_lite/decoder/version"

module YrbLite
  # Plain-text reconstruction of a stored Yjs document, in pure Ruby — for search
  # indexing and previews. The core `yrb-lite` gem moves and stores opaque CRDT
  # updates without reading them; this reads the text out of the shared type the
  # editor uses (Lexical's `Y.XmlText`, plain `Y.Text`, or ProseMirror's
  # `Y.XmlFragment`), in-process, on the native extension core already ships — no
  # Node, no subprocess, no binary.
  #
  #   state = doc.encode_state_as_update        # opaque CRDT bytes from the store
  #   YrbLite::Decoder.text(state)              # => "hello world"
  #   YrbLite::Decoder.preview(state, 280)      # => "hello world…"
  #
  # Full-fidelity reconstruction (the exact Lexical EditorState / HTML, which
  # needs @lexical/yjs) is a separate, opt-in concern — see the `yrb-lite-decode`
  # package's Bun binary. This gem stays pure Ruby on purpose.
  module Decoder
    class Error < YrbLite::Error; end

    module_function

    # Plain text of the document. `field` pins the root key (Lexical: the editor
    # id; ProseMirror: "default"); omit it to use the document's sole root.
    def text(state, field: nil)
      field ||= YrbLite::Doc.new.tap { |d| d.apply_update(state) }.root_names.first
      return "" unless field

      # Lexical XmlText and plain Text read straight to text. (read_text coerces
      # the root, so each attempt gets a fresh doc.)
      direct = load(state).read_text(field)
      return normalize(direct) if direct && !direct.strip.empty?

      # ProseMirror XmlFragment serializes as XML markup — strip the tags.
      markup = load(state).read_xml(field)
      markup ? normalize(strip_tags(markup)) : ""
    end

    # A compact, single-line preview for list UIs.
    def preview(state, limit: 280, field: nil)
      body = text(state, field: field).gsub(/\s+/, " ").strip
      body.length > limit ? "#{body[0, limit].rstrip}…" : body
    end

    def load(state)
      YrbLite::Doc.new.tap { |doc| doc.apply_update(state) }
    end

    def strip_tags(markup)
      markup.gsub(/<[^>]*>/, " ")
    end

    def normalize(text)
      text.gsub(/[ \t]+/, " ").gsub(/\n{3,}/, "\n\n").strip
    end
  end
end
