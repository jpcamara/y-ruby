# frozen_string_literal: true

require_relative "yrb_lite/version"

# Load the native extension. Precompiled gems ship it in a per-Ruby-version
# subdir (lib/yrb_lite/<major.minor>/yrb_lite.<ext>); a source build puts it
# flat at lib/yrb_lite/yrb_lite.<ext>. Try the versioned path first, fall back.
begin
  RUBY_VERSION =~ /(\d+\.\d+)/
  require_relative "yrb_lite/#{Regexp.last_match(1)}/yrb_lite"
rescue LoadError
  require_relative "yrb_lite/yrb_lite"
end

module YrbLite
  # Error class is defined in the Rust extension.
  #
  # The ActionCable integration (YrbLite::ActionCable::Sync) lives in the
  # separate `yrb-lite-actioncable` gem; require "yrb_lite/action_cable".
end
