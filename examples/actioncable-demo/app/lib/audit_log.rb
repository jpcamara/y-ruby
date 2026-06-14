# frozen_string_literal: true

require "base64"
require "fileutils"

# A durable, append-only audit log of every document change — the demo's
# stand-in for whatever Wealthbox records to. yrb-lite's `on_change` hook
# calls `record` *before* the change is applied or broadcast, and serialized
# per document, so this log is the authoritative order of changes.
#
# Each entry is one CRDT update delta (base64). Replaying the entries in
# order onto a fresh Y.Doc reconstructs the document exactly.
#
# It also supports fault injection (delay / fail-once) so the end-to-end
# tests can drive the store's behavior and prove that no other client ever
# sees a change before it's stored.
class AuditLog
  @mutex = Mutex.new
  @control_mutex = Mutex.new

  class << self
    # Synchronously persist a change. Writes + fsyncs before returning, so a
    # successful return means the change is durable. Raising here (e.g. disk
    # full) makes yrb-lite reject the change: it is never applied or sent.
    #
    # The on-disk log is the shared source of truth — every server process
    # appends to the same file (O_APPEND is atomic), so the audit history is
    # global across a multi-process deployment, not per-process.
    def record(key, update)
      simulate_latency(key)
      raise "audit store unavailable (injected for #{key})" if fail_injected?(key)

      encoded = Base64.strict_encode64(update)
      @mutex.synchronize do
        File.open(path_for(key), "a") do |file|
          file.write("#{encoded}\n")
          file.flush
          file.fsync
        end
      end
    end

    def entries(key)
      path = path_for(key)
      return [] unless File.exist?(path)

      File.readlines(path, chomp: true).reject(&:empty?)
    end

    # Rebuild a document from its on-disk audit log by replaying every recorded
    # delta. Used as the `on_load` hook, so a document survives eviction or a
    # server crash. Tolerant of a torn final line (a crash mid-fsync-append):
    # an undecodable line is skipped rather than corrupting the rebuild.
    # Returns a single merged Y.js update, or nil for an empty/missing log.
    def replay(key)
      path = path_for(key)
      return nil unless File.exist?(path)

      doc = YrbLite::Doc.new
      applied = 0
      File.foreach(path) do |line|
        line = line.strip
        next if line.empty?

        begin
          doc.apply_update(Base64.strict_decode64(line))
          applied += 1
        rescue StandardError
          next # torn/partial line from a crash mid-append — skip it
        end
      end
      applied.zero? ? nil : doc.encode_state_as_update
    end

    # -- Fault injection / test controls -----------------------------------
    #
    # State lives in a file so it works ACROSS processes — under AnyCable the
    # control endpoint runs in Puma but `record` runs in the RPC server.

    def set_delay(key, seconds)
      update_fault(key) { |f| f["delay_ms"] = seconds.to_f * 1000 }
    end

    def fail_next(key)
      update_fault(key) { |f| f["fail_once"] = true }
    end

    def reset!(key)
      @mutex.synchronize do
        [path_for(key), fault_path(key)].each { |p| File.delete(p) if File.exist?(p) }
      end
    end

    private

    def simulate_latency(key)
      fault = read_fault(key)
      delay = fault["delay_ms"].to_f / 1000
      sleep(delay) if delay.positive?
    end

    # Consume a one-shot failure flag (atomically rewrites the fault file).
    def fail_injected?(key)
      @control_mutex.synchronize do
        fault = read_fault(key)
        next false unless fault["fail_once"]

        fault.delete("fail_once")
        write_fault(key, fault)
        true
      end
    end

    def update_fault(key)
      @control_mutex.synchronize do
        fault = read_fault(key)
        yield fault
        write_fault(key, fault)
      end
    end

    def read_fault(key)
      path = fault_path(key)
      return {} unless File.exist?(path)

      JSON.parse(File.read(path))
    rescue StandardError
      {}
    end

    def write_fault(key, fault)
      if fault.empty?
        File.delete(fault_path(key)) if File.exist?(fault_path(key))
      else
        File.write(fault_path(key), JSON.generate(fault))
      end
    end

    def fault_path(key)
      Pathname.new("#{path_for(key)}.fault")
    end

    def path_for(key)
      dir = Rails.root.join("tmp", "audit")
      FileUtils.mkdir_p(dir)
      dir.join("#{key.gsub(/[^a-zA-Z0-9_-]/, '_')}.log")
    end
  end
end
