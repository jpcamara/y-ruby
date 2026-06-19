# frozen_string_literal: true

require "bundler"
require "rake/testtask"
require "rake/extensiontask"
require "rb_sys/extensiontask"

# This repo ships two gems (core `yrb-lite` + `yrb-lite-actioncable`), so the
# default bundler/gem_tasks can't auto-pick a gemspec. Scope build/release/install
# to the core gem; the pure-Ruby actioncable gem builds via `rake actioncable:build`.
Bundler::GemHelper.install_tasks(name: "yrb-lite")

Rake::TestTask.new(:test) do |t|
  t.libs << "test"
  t.libs << "lib"
  t.test_files = FileList["test/**/*_test.rb"]
end

desc "Build the yrb-lite-actioncable gem into pkg/"
task "actioncable:build" do
  require_relative "lib/yrb_lite/action_cable/version"
  mkdir_p "pkg"
  sh "gem build yrb-lite-actioncable.gemspec --output " \
     "pkg/yrb-lite-actioncable-#{YrbLite::ActionCable::VERSION}.gem"
end

# Passing the gemspec registers the cross-compilation tasks
# (`native:<platform> gem`) that the precompiled-gem build relies on.
GEMSPEC = Gem::Specification.load("yrb-lite.gemspec")

RbSys::ExtensionTask.new("yrb_lite", GEMSPEC) do |ext|
  ext.lib_dir = "lib/yrb_lite"
end

task default: %i[compile test]

desc "Clean build artifacts"
task :clean do
  sh "cargo clean" if File.exist?("Cargo.toml")
  rm_rf "tmp"
  rm_rf "lib/yrb_lite/yrb_lite.bundle"
  rm_rf "lib/yrb_lite/yrb_lite.so"
end
