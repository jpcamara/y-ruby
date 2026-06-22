# frozen_string_literal: true

require "test_helper"
require_relative "fixtures/yjs_fixtures"
require "yrb_lite/action_cable"

class SyncTest < Minitest::Test
  def setup
    YrbLite::ActionCable::Sync.reset!
  end

  def update_message(update_bytes, id: nil)
    frame = YrbLite::Awareness.new.encode_update(update_bytes)
    { "update" => Base64.strict_encode64(frame) }.tap do |payload|
      payload["id"] = id unless id.nil?
    end
  end

  def doc_state(updates)
    return nil if updates.empty?

    doc = YrbLite::Doc.new
    updates.each { |u| doc.apply_update(u) }
    doc.encode_state_as_update
  end

  def helper_for(store: [], recorder: nil, transmits: [], broadcasts: [])
    recorder ||= ->(_key, update) { store << update }
    loader = ->(_key) { doc_state(store) }
    klass = Class.new do
      include YrbLite::ActionCable::Sync

      attr_accessor :transmits, :broadcasts, :streams

      def transmit(data) = transmits << data

      def stream_from(name, **opts, &)
        streams << [name, opts, !block_given?]
      end

      define_method(:sync_distribute) { |encoded| broadcasts << encoded }
    end
    klass.on_load(&loader)
    recorder.is_a?(Proc) ? klass.on_change(&recorder) : klass.on_change(recorder)
    helper = klass.new
    helper.transmits = transmits
    helper.broadcasts = broadcasts
    helper.streams = []
    helper
  end

  def acks_in(transmits)
    transmits.filter_map { |t| t["ack"] if t.is_a?(Hash) && t.key?("ack") }
  end

  def test_sync_requires_loader_and_recorder
    no_loader = Class.new do
      include YrbLite::ActionCable::Sync

      on_change { |_key, _update| nil }
    end
    no_recorder = Class.new do
      include YrbLite::ActionCable::Sync

      on_load { |_key| nil }
    end

    assert_match(/on_load/, assert_raises(YrbLite::Error) { no_loader.new.sync_for("doc") }.message)
    assert_match(/on_change/, assert_raises(YrbLite::Error) { no_recorder.new.sync_for("doc") }.message)
  end

  def test_config_is_inherited_by_subclasses
    base = Class.new do
      include YrbLite::ActionCable::Sync

      on_load { |_key| nil }
      on_change { |_key, _update| nil }
    end
    sub = Class.new(base)

    refute_nil sub.on_load
    refute_nil sub.on_change
  end

  def test_max_frame_bytes_default_override_and_disable
    klass = Class.new { include YrbLite::ActionCable::Sync }

    assert_equal YrbLite::ActionCable::Sync::DEFAULT_MAX_FRAME_BYTES, klass.max_frame_bytes
    klass.max_frame_bytes 1024

    assert_equal 1024, klass.max_frame_bytes
    klass.max_frame_bytes nil

    assert_nil klass.max_frame_bytes
  end

  def test_sync_for_uses_stateless_streams_and_answers_from_store
    store = [YjsFixtures::TwoDocsMerged::DOC1_UPDATE]
    helper = helper_for(store: store)
    helper.sync_for("doc")

    assert_equal [["yrb_lite:doc", {}, true]], helper.streams
    assert_equal 1, helper.transmits.length

    response = Base64.strict_decode64(helper.transmits.first["update"])

    assert_equal YrbLite::ActionCable::Sync::MSG_KIND_SYNC_STEP1,
                 YrbLite::Awareness.new.message_kind(response)
  end

  def test_anycable_whisper_is_scoped_to_awareness_stream
    helper = helper_for
    helper.define_singleton_method(:whispers_to) { |_broadcasting| nil }
    helper.sync_for("doc")

    assert_includes helper.streams, ["yrb_lite:doc", {}, true],
                    "document stream has no whisper option"
    assert_includes helper.streams, ["yrb_lite:doc:awareness", { whisper: true }, true],
                    "awareness stream is whisper-enabled"
  end

  def test_answers_sync_step1_from_the_store
    source = YrbLite::Doc.new
    source.apply_update(YjsFixtures::TwoDocsMerged::DOC1_UPDATE)
    transmits = []
    helper = helper_for(store: [YjsFixtures::TwoDocsMerged::DOC1_UPDATE], transmits: transmits)

    helper.sync_receive({ "update" => Base64.strict_encode64(YrbLite::Doc.new.sync_step1) }, "doc-key")

    assert_equal 1, transmits.length
    response = Base64.strict_decode64(transmits.first["update"])
    delta = YrbLite::Awareness.new.update_from_message(response)
    rebuilt = YrbLite::Doc.new
    rebuilt.apply_update(delta)

    assert_equal source.encode_state_vector, rebuilt.encode_state_vector
  end

  def test_records_then_relays_and_acks_update
    store = []
    recorded = []
    broadcasts = []
    transmits = []
    helper = helper_for(store: store, recorder: lambda { |k, u|
      recorded << [k, u]
      store << u
    },
                        transmits: transmits, broadcasts: broadcasts)

    helper.sync_receive(update_message(YjsFixtures::TwoDocsMerged::DOC1_UPDATE, id: 7), "doc-key")

    assert_equal [["doc-key", YjsFixtures::TwoDocsMerged::DOC1_UPDATE]], recorded
    assert_equal 1, broadcasts.length
    assert_equal [7], acks_in(transmits)
  end

  def test_no_ack_without_id
    helper = helper_for

    helper.sync_receive(update_message(YjsFixtures::TwoDocsMerged::DOC1_UPDATE), "doc-key")

    assert_empty acks_in(helper.transmits)
  end

  def test_no_op_update_is_not_recorded_relayed_or_acked
    store = []
    recorded = []
    broadcasts = []
    transmits = []
    helper = helper_for(store: store, recorder: lambda { |_k, u|
      recorded << u
      store << u
    },
                        transmits: transmits, broadcasts: broadcasts)

    helper.sync_receive(update_message(YjsFixtures::EmptyDoc::UPDATE, id: 9), "doc-key")

    assert_empty recorded
    assert_empty broadcasts
    assert_empty acks_in(transmits)
  end

  def test_rejects_gapped_update_and_requests_resync
    store = []
    broadcasts = []
    transmits = []
    helper = helper_for(store: store, transmits: transmits, broadcasts: broadcasts)

    helper.sync_receive(update_message(YjsFixtures::CausalChain::U1, id: 1), "doc-key")
    helper.sync_receive(update_message(YjsFixtures::CausalChain::U3, id: 2), "doc-key")

    assert_equal [YjsFixtures::CausalChain::U1], store
    assert_equal 1, broadcasts.length
    assert_equal [1], acks_in(transmits)
    assert_operator transmits.length, :>, 1, "gapped update should trigger a SyncStep1 resync"
  end

  def test_gap_heals_after_client_resyncs
    store = []
    helper = helper_for(store: store)

    helper.sync_receive(update_message(YjsFixtures::CausalChain::U1), "doc-key")
    helper.sync_receive(update_message(YjsFixtures::CausalChain::U3), "doc-key")

    client = YrbLite::Doc.new
    [YjsFixtures::CausalChain::U1, YjsFixtures::CausalChain::U2,
     YjsFixtures::CausalChain::U3].each { |u| client.apply_update(u) }
    server = YrbLite::Doc.new
    store.each { |u| server.apply_update(u) }
    resync = client.encode_state_as_update(server.encode_state_vector)

    helper.sync_receive(update_message(resync), "doc-key")

    replay = YrbLite::Doc.new
    store.each { |u| replay.apply_update(u) }

    refute_predicate replay, :pending?
    assert_equal client.encode_state_as_update, replay.encode_state_as_update
  end

  def test_record_failure_rejects_change
    broadcasts = []
    helper = helper_for(recorder: ->(_key, _update) { raise "store unavailable" }, broadcasts: broadcasts)

    assert_raises(RuntimeError) do
      helper.sync_receive(update_message(YjsFixtures::TwoDocsMerged::DOC1_UPDATE, id: 5), "doc-key")
    end

    assert_empty broadcasts
    assert_empty acks_in(helper.transmits)
  end

  def test_block_recorder_runs_in_channel_instance_context
    seen = nil
    klass = Class.new do
      include YrbLite::ActionCable::Sync

      on_load { |_key| nil }
      on_change { |_key, _update| seen = current_author }

      attr_accessor :transmits, :broadcasts

      def current_author = "user-42"
      def transmit(data) = transmits << data
      define_method(:sync_distribute) { |encoded| broadcasts << encoded }
    end
    helper = klass.new
    helper.transmits = []
    helper.broadcasts = []

    helper.sync_receive(update_message(YjsFixtures::TwoDocsMerged::DOC1_UPDATE), "doc-key")

    assert_equal "user-42", seen
  end

  def test_callable_recorder_uses_call
    seen = []
    recorder = Object.new
    recorder.define_singleton_method(:call) { |key, update| seen << [key, update.bytesize] }
    helper = helper_for(recorder: recorder)

    helper.sync_receive(update_message(YjsFixtures::TwoDocsMerged::DOC1_UPDATE), "doc-key")

    assert_equal "doc-key", seen.first.first
    assert_operator seen.first.last, :>, 0
  end

  def test_awareness_frames_are_relayed_but_not_recorded
    recorded = []
    broadcasts = []
    helper = helper_for(recorder: ->(_key, update) { recorded << update }, broadcasts: broadcasts)
    presence = YrbLite::Awareness.new
    presence.set_local_state('{"user":"alice"}')

    helper.sync_receive({ "update" => Base64.strict_encode64(presence.encode_awareness_update) }, "doc-key")

    assert_empty recorded
    assert_equal 1, broadcasts.length
  end

  def test_malformed_and_oversized_frames_are_dropped
    helper = helper_for
    helper.class.max_frame_bytes 4

    helper.sync_receive({ "update" => "not-base64", "id" => 1 }, "doc-key")
    helper.sync_receive(update_message(YjsFixtures::TwoDocsMerged::DOC1_UPDATE, id: 2), "doc-key")

    assert_empty helper.broadcasts
    assert_empty acks_in(helper.transmits)
  end

  def test_lost_ack_retry_acks_without_double_recording
    store = []
    broadcasts = []
    transmits = []
    helper = helper_for(store: store, transmits: transmits, broadcasts: broadcasts)
    msg = update_message(YjsFixtures::TwoDocsMerged::DOC1_UPDATE, id: 5)

    helper.sync_receive(msg, "doc-key")
    helper.sync_receive(msg, "doc-key")

    assert_equal [YjsFixtures::TwoDocsMerged::DOC1_UPDATE], store
    assert_equal 1, broadcasts.length
    assert_equal [5, 5], acks_in(transmits)
  end
end
