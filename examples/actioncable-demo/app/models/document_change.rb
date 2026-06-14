# frozen_string_literal: true

# One recorded CRDT update delta for a document. The bigserial `id` orders
# changes across all server processes.
class DocumentChange < ApplicationRecord
end
