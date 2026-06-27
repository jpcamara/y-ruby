//! Pure content-reading helpers over yrs shared types — no magnus/Ruby, so they
//! can be unit-tested directly in Rust (like `protocol.rs`). The binding layer in
//! `lib.rs` is a thin wrapper that opens a transaction and calls these.

use yrs::{GetString, ReadTxn, XmlFragment, XmlFragmentRef, XmlOut};

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

#[cfg(test)]
mod tests {
    use super::*;
    use yrs::{Doc, Transact, XmlElementPrelim, XmlTextPrelim};

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
}
