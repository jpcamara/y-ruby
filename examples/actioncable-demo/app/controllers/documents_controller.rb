# frozen_string_literal: true

class DocumentsController < ApplicationController
  # The audit control endpoint is a test hook (POST without a form token).
  skip_forgery_protection only: :audit_control

  # The collaborative editor page.
  def show
    @document_id = params[:id]
  end

  # Server-side read of the authoritative document: the raw CRDT state,
  # base64-encoded. Replays the durable store into a fresh Y.Doc state.
  def content
    update = Store.current.replay(params[:id])
    return render json: { error: "No such document" }, status: :not_found unless update

    render json: { state: Base64.strict_encode64(update) }
  end

  # The audit log for a document (AUDIT mode): every recorded change, in order,
  # as base64 CRDT update deltas. Replaying them rebuilds the document.
  def audit
    entries = Store.current.entries(params[:id])
    render json: { count: entries.length, updates: entries }
  end

  # Test hook: drive the durable store's behavior so the end-to-end suite can
  # exercise record-before-distribute.
  #   reset=1        clear this document's log + injected faults
  #   delay_ms=N     make the next writes take N ms (a slow durable store)
  #   fail_once=1    make the next write raise (store unavailable)
  def audit_control
    Store.current.reset!(params[:id]) if params[:reset]
    Fault.set_delay(params[:id], params[:delay_ms].to_f / 1000) if params[:delay_ms]
    Fault.fail_next(params[:id]) if params[:fail_once]
    head :no_content
  end
end
