# frozen_string_literal: true

require "test_helper"
require_relative "fixtures/yjs_fixtures"

# Pending-struct handling and gap-free serving.
#
# A gappy update (one whose causally-prior update is missing) parks in yrs as a
# *pending* struct: the doc's integrated state stays empty, but the pending block
# is a recovery buffer that heals if the missing dependency later arrives.
#
# The danger is that `encode_state_as_update` merges pending back in, so serving
# that state hands a peer content it can't integrate -- the peer parks the same
# pending forever and the state-vector/content mismatch drives endless resync
# traffic. So the sync path and `compacted_state_update` must serve integrated
# state only, while `encode_state_as_update` stays lossless for raw recovery.
class PendingTest < Minitest::Test
  FIRST = YjsFixtures::Gap::FIRST
  DEPENDENT = YjsFixtures::Gap::DEPENDENT

  # --- detection ---

  def test_clean_doc_is_not_pending
    doc = Y::Doc.new
    doc.apply_update(FIRST)

    refute_predicate doc, :pending?
  end

  def test_gappy_update_parks_as_pending
    doc = Y::Doc.new
    doc.apply_update(DEPENDENT) # depends on the missing FIRST

    assert_predicate doc, :pending?
    assert_nil doc.read_text("notepad"), "no integrated content while pending"
  end

  def test_pending_clears_once_the_missing_dependency_arrives
    doc = Y::Doc.new
    doc.apply_update(DEPENDENT)
    doc.apply_update(FIRST)

    refute_predicate doc, :pending?, "gap healed"
    assert_equal "ab", doc.read_text("notepad")
  end

  # --- compacted_state_update (gap-free full state) ---

  def test_compacted_matches_full_encode_when_clean
    doc = Y::Doc.new
    doc.apply_update(FIRST)

    assert_equal doc.encode_state_as_update, doc.compacted_state_update
  end

  def test_compacted_excludes_pending_while_encode_keeps_it
    doc = Y::Doc.new
    doc.apply_update(DEPENDENT)

    full = doc.encode_state_as_update
    compacted = doc.compacted_state_update

    refute_equal full, compacted, "compacted drops the pending bytes"

    # The lossless encode still round-trips the pending (recovery); the compacted
    # one does not poison a fresh peer.
    lossless_peer = Y::Doc.new
    lossless_peer.apply_update(full)

    assert_predicate lossless_peer, :pending?, "encode_state_as_update preserved the pending"

    clean_peer = Y::Doc.new
    clean_peer.apply_update(compacted)

    refute_predicate clean_peer, :pending?, "compacted_state_update carried no pending"
  end

  def test_compacted_is_non_destructive
    doc = Y::Doc.new
    doc.apply_update(DEPENDENT)
    doc.compacted_state_update

    assert_predicate doc, :pending?, "compacting did not mutate the source doc"
  end

  def test_compacted_serves_content_once_healed
    doc = Y::Doc.new
    doc.apply_update(DEPENDENT)
    doc.apply_update(FIRST)

    peer = Y::Doc.new
    peer.apply_update(doc.compacted_state_update)

    assert_equal "ab", peer.read_text("notepad")
  end

  # --- the sync path serves gap-free by default ---

  def test_sync_step2_reply_does_not_poison_a_peer
    # A server whose stored state contains a legacy gappy update.
    server = Y::Doc.new
    server.apply_update(DEPENDENT)

    # A fresh client announces its (empty) state; the server answers SyncStep2.
    client = Y::Doc.new
    reply = server.handle_sync_message(client.sync_step1)[2]
    client.handle_sync_message(reply)

    refute_predicate client, :pending?, "the server served integrated-only state, no poison"
  end

  def test_sync_step2_still_delivers_real_content
    server = Y::Doc.new
    server.apply_update(YjsFixtures::TextHelloWorld::UPDATE)

    client = Y::Doc.new
    reply = server.handle_sync_message(client.sync_step1)[2]
    client.handle_sync_message(reply)

    assert_equal "hello world", client.read_text("content")
  end
end
