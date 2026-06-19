# frozen_string_literal: true

require "yrb_lite"
require "yrb_lite/action_cable/version"

module YrbLite
  # ActionCable integration for yrb-lite.
  #
  # Provides YrbLite::ActionCable::Sync, a channel concern implementing the
  # y-websocket sync protocol and awareness/presence over ActionCable (and
  # AnyCable), so a Rails app can be the collaboration server for Y.js editors
  # with no Node sidecar. The CRDT documents, awareness, and protocol primitives
  # themselves come from the core `yrb-lite` gem.
  module ActionCable
  end
end

require "yrb_lite/action_cable/sync"
