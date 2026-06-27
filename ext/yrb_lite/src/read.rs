//! Pure content-reading helpers over yrs shared types — no magnus/Ruby, so they
//! can be unit-tested directly in Rust (like `protocol.rs`). The binding layer in
//! `lib.rs` is a thin wrapper that opens a transaction and calls these.

use std::collections::HashMap;
use std::sync::Arc;
use yrs::{Any, Array, GetString, Map, MapRef, Out, ReadTxn, XmlFragment, XmlFragmentRef, XmlOut};

/// Read an XML-shaped root as text, one top-level block per line.
///
/// ProseMirror stores blocks as `Y.XmlElement` children (`<paragraph>…`);
/// Lexical stores each block as a sibling `Y.XmlText` (its node metadata is an
/// embed, which yrs omits from the string). We serialize each top-level child and
/// join with "\n", so adjacent blocks don't merge into one run of words. Without
/// the separator, Lexical — whose blocks carry no element tags — would glue
/// paragraphs together (e.g. "first paragraphsecond paragraph"), breaking word
/// boundaries for search/preview. Element tags are kept (the caller strips them);
/// deeper nesting is flattened, but its inner tags still separate words after
/// stripping.
pub fn xml_blocks_text<T: ReadTxn>(txn: &T, fragment: &XmlFragmentRef) -> String {
    fragment
        .children(txn)
        .map(|node| match node {
            XmlOut::Element(e) => e.get_string(txn),
            XmlOut::Text(t) => t.get_string(txn),
            XmlOut::Fragment(f) => f.get_string(txn),
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Read a `Y.Map` root as a JSON object string (keys sorted for stable output).
///
/// The complement to `read_text`/`read_xml` for structured state — e.g. a shared
/// "view state" map. Values are converted recursively: primitives pass through;
/// nested `Y.Map`/`Y.Array` recurse; `Y.Text`/XML values stringify. The caller
/// parses the JSON (yrs's own `Out::to_json` is crate-private, so we walk the
/// `Out` variants ourselves here).
pub fn map_json<T: ReadTxn>(txn: &T, map: &MapRef) -> String {
    let mut pairs: Vec<(String, Any)> = map
        .iter(txn)
        .map(|(k, v)| (k.to_string(), out_to_any(txn, &v)))
        .collect();
    pairs.sort_by(|a, b| a.0.cmp(&b.0)); // deterministic key order
    let mut out = String::from("{");
    for (i, (k, v)) in pairs.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        // Any::to_json serializes from the start of the buffer (it doesn't
        // append), so each piece goes into its own String, then concatenated.
        out.push_str(&any_to_json(&Any::String(Arc::from(k.as_str())))); // JSON-escaped key
        out.push(':');
        out.push_str(&any_to_json(v));
    }
    out.push('}');
    out
}

fn any_to_json(a: &Any) -> String {
    let mut s = String::new();
    a.to_json(&mut s);
    s
}

/// Convert a yrs output value to an `Any` (which knows how to JSON-serialize),
/// recursing through nested shared collections.
fn out_to_any<T: ReadTxn>(txn: &T, out: &Out) -> Any {
    match out {
        Out::Any(a) => a.clone(),
        Out::YText(v) => Any::from(v.get_string(txn)),
        Out::YXmlText(v) => Any::from(v.get_string(txn)),
        Out::YXmlElement(v) => Any::from(v.get_string(txn)),
        Out::YXmlFragment(v) => Any::from(v.get_string(txn)),
        Out::YArray(arr) => {
            let items: Vec<Any> = arr.iter(txn).map(|o| out_to_any(txn, &o)).collect();
            Any::Array(items.into())
        }
        Out::YMap(m) => {
            let mut hm: HashMap<String, Any> = HashMap::new();
            for (k, v) in m.iter(txn) {
                hm.insert(k.to_string(), out_to_any(txn, &v));
            }
            Any::Map(Arc::new(hm))
        }
        _ => Any::Null,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use yrs::{Doc, MapPrelim, Transact, XmlElementPrelim, XmlTextPrelim};

    #[test]
    fn prosemirror_blocks_keep_tags_and_separate_with_newlines() {
        let doc = Doc::new();
        let frag = doc.get_or_insert_xml_fragment("pm");
        {
            let mut txn = doc.transact_mut();
            let h = frag.push_back(&mut txn, XmlElementPrelim::empty("heading"));
            h.push_back(&mut txn, XmlTextPrelim::new("Title"));
            let p = frag.push_back(&mut txn, XmlElementPrelim::empty("paragraph"));
            p.push_back(&mut txn, XmlTextPrelim::new("Body"));
        }
        let txn = doc.transact();
        assert_eq!(
            xml_blocks_text(&txn, &frag),
            "<heading>Title</heading>\n<paragraph>Body</paragraph>"
        );
    }

    #[test]
    fn lexical_style_sibling_text_blocks_separate_with_newlines() {
        // Lexical stores each block as a sibling XmlText with no element tags;
        // this is the case a flat read glued together.
        let doc = Doc::new();
        let frag = doc.get_or_insert_xml_fragment("lex");
        {
            let mut txn = doc.transact_mut();
            frag.push_back(&mut txn, XmlTextPrelim::new("first paragraph"));
            frag.push_back(&mut txn, XmlTextPrelim::new("second paragraph"));
        }
        let txn = doc.transact();
        assert_eq!(
            xml_blocks_text(&txn, &frag),
            "first paragraph\nsecond paragraph"
        );
    }

    #[test]
    fn single_block_has_no_trailing_separator() {
        let doc = Doc::new();
        let frag = doc.get_or_insert_xml_fragment("one");
        {
            let mut txn = doc.transact_mut();
            frag.push_back(&mut txn, XmlTextPrelim::new("only"));
        }
        let txn = doc.transact();
        assert_eq!(xml_blocks_text(&txn, &frag), "only");
    }

    #[test]
    fn empty_fragment_is_blank() {
        let doc = Doc::new();
        let frag = doc.get_or_insert_xml_fragment("empty");
        let txn = doc.transact();
        assert_eq!(xml_blocks_text(&txn, &frag), "");
    }

    #[test]
    fn map_json_serializes_primitives_with_sorted_keys() {
        let doc = Doc::new();
        let map = doc.get_or_insert_map("state");
        {
            let mut txn = doc.transact_mut();
            map.insert(&mut txn, "title", "Dashboard");
            map.insert(&mut txn, "count", 3_i64);
            map.insert(&mut txn, "active", true);
        }
        let txn = doc.transact();
        assert_eq!(
            map_json(&txn, &map),
            r#"{"active":true,"count":3,"title":"Dashboard"}"#
        );
    }

    #[test]
    fn map_json_recurses_into_nested_map() {
        let doc = Doc::new();
        let map = doc.get_or_insert_map("state");
        {
            let mut txn = doc.transact_mut();
            let inner = map.insert(&mut txn, "user", MapPrelim::default());
            inner.insert(&mut txn, "name", "Ada");
        }
        let txn = doc.transact();
        assert_eq!(map_json(&txn, &map), r#"{"user":{"name":"Ada"}}"#);
    }

    #[test]
    fn map_json_empty_is_object() {
        let doc = Doc::new();
        let map = doc.get_or_insert_map("state");
        let txn = doc.transact();
        assert_eq!(map_json(&txn, &map), "{}");
    }
}
