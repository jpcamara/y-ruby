# frozen_string_literal: true

require "bundler/gem_tasks"
require "rake/testtask"
require "rake/extensiontask"
require "rb_sys/extensiontask"

Rake::TestTask.new(:test) do |t|
  t.libs << "test"
  t.libs << "lib"
  t.test_files = FileList["test/**/*_test.rb"]
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
