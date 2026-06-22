# frozen_string_literal: true

# Collaborative document channel. The whole y-websocket protocol is the three
# lines of YrbLite::ActionCable::Sync below. Documents are loaded from and
# recorded to Store.current; ActionCable process memory is not authoritative.
class DocumentChannel < ApplicationCable::Channel
  include YrbLite::ActionCable::Sync

  on_load  { |key| Store.current.replay(key) }
  on_change { |key, update| Store.current.record(key, update) }

  # Pass params[:id] on every action so the channel works under AnyCable too,
  # where each RPC command gets a fresh channel instance (no ivars persist).
  def subscribed
    sync_for params[:id]
  end

  def receive(data)
    sync_receive(data, params[:id])
  end

  def unsubscribed
    sync_unsubscribed(params[:id])
  end
end
