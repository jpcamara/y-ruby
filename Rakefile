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

namespace :release do
  desc "Print the release sequence for all packages (2 gems + 1 npm package)"
  task :steps do
    require "json"
    require_relative "lib/yrb_lite/version"
    require_relative "lib/yrb_lite/action_cable/version"
    core = YrbLite::VERSION
    cable = YrbLite::ActionCable::VERSION
    npm = JSON.parse(File.read("packages/yrb-lite-reliable/package.json"))["version"]
    puts <<~STEPS
      This repo ships THREE publishable packages, versioned independently. Release the
      two gems together when the shared core API changes. JP runs the push steps
      (RubyGems MFA, npm auth, and the default-branch guard).

      1) yrb-lite #{core}  — core gem, native extension; precompiled platform gems via CI
         a. bump lib/yrb_lite/version.rb + CHANGELOG.md, then commit
         b. git tag v#{core} && git push origin main "v#{core}"
         c. the "Precompiled gems" workflow builds 8 platform gems + the source gem
         d. gh run download <run-id> --dir tmp/ ; cp tmp/**/*.gem pkg/
         e. gem push pkg/yrb-lite-#{core}*.gem        # 9 gems: source + 8 platforms

      2) yrb-lite-actioncable #{cable}  — gem, pure Ruby; one gem, no precompilation
         a. bump lib/yrb_lite/action_cable/version.rb + CHANGELOG-actioncable.md, commit
         b. rake actioncable:build
         c. gem push pkg/yrb-lite-actioncable-#{cable}.gem

      3) yrb-lite-reliable #{npm}  — npm package (client reliable-delivery core)
         a. bump packages/yrb-lite-reliable/package.json version, commit
         b. cd packages/yrb-lite-reliable && npm publish

      The actioncable gem depends on `yrb-lite >= 0.1.0.beta5` (a floor, so it tolerates
      newer core releases); only raise it when it needs a newer core API.
    STEPS
  end
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
