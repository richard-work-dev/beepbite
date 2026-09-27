// Shared types for the /inventory surface — mirrors
// backend/migrations/001_baseline.sql tables and
// backend/internal/handlers/inventory/*.go DTOs.

// Mirrors backend/migrations/001_baseline.sql `suppliers` table.
export interface Supplier {
  id: string;
  organization_id: string;
  name: string;
  display_name?: string | null;
  tax_id?: string | null;
  payment_terms_days: number;
  default_currency: string;
  website?: string | null;
  notes?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Mirrors backend/migrations/001_baseline.sql `supplier_contacts` table.
export interface SupplierContact {
  id: string;
  supplier_id: string;
  name: string;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

// Mirrors backend/migrations/001_baseline.sql `supplier_invoices` table.
export interface SupplierInvoice {
  id: string;
  supplier_id: string;
  location_id: string;
  invoice_number: string;
  invoice_date: string;
  due_date?: string | null;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  currency: string;
  status: 'pending' | 'matched' | 'disputed' | 'approved' | 'paid' | 'cancelled';
  match_status: 'unmatched' | 'price_variance' | 'qty_variance' | 'matched';
  paid_at?: string | null;
  notes?: string | null;
  pdf_url?: string | null;
  created_at: string;
  updated_at: string;
}

// Mirrors backend/migrations/001_baseline.sql `goods_receipts` table.
export interface GoodsReceiptLine {
  id: string;
  inventory_item_id: string;
  item_name: string;
  quantity_received: number;
  unit: string;
  unit_price_cents?: number;
}

export interface GoodsReceipt {
  id: string;
  purchase_order_id: string;
  receipt_number?: string | null;
  received_by?: string | null;
  received_at: string | null;
  delivery_note_number?: string | null;
  notes?: string | null;
  created_at: string;
  po_number?: string;
  supplier_name?: string;
  line_count?: number;
  total_quantity?: number;
  status?: 'pending' | 'received';
  lines?: GoodsReceiptLine[];
}

// Mirrors backend/internal/handlers/inventory/handler.go's receiveGRN 200 response.
export interface ReceiveGRNResult {
  grn_id: string;
  lines_processed: number;
  status: string;
}

// Mirrors backend/internal/handlers/inventory/store.go MatchLine.
export interface MatchLine {
  invoice_line_id: string;
  purchase_order_item_id?: string | null;
  invoice_qty: number;
  po_qty: number;
  grn_qty: number;
  invoice_price_cents: number;
  po_price_cents: number;
  grn_price_cents: number;
  qty_variance_pct: number;
  price_variance_pct: number;
  has_variance: boolean;
}

// Mirrors backend/internal/handlers/inventory/match.go MatchResult — the
// response of POST /inventory/supplier-invoices/{id}/match.
export interface MatchResult {
  invoice_id: string;
  match_status: SupplierInvoice['match_status'];
  tolerance_pct: number;
  lines: MatchLine[];
}

// Mirrors backend/internal/handlers/inventory/store.go POLineInput.
export interface POSuggestionLine {
  inventory_item_id: string;
  item_name?: string;
  current_stock?: number;
  minimum_stock?: number;
  on_order_quantity?: number;
  supplier_inventory_item_id?: string;
  ordered_quantity: number;
  ordered_unit: string;
  ordered_unit_price_cents: number;
  notes?: string;
}

// Mirrors backend/internal/handlers/inventory/handler.go POSuggestion — one
// element of GET /inventory/auto-po-suggestions's `suggestions` array.
export interface POSuggestion {
  location_id: string;
  supplier_id: string;
  supplier_name: string;
  status: string;
  lines: POSuggestionLine[];
  estimated_total_cents: number;
}

export interface AutoPOSuggestionsResponse {
  location_id: string;
  suggestions: POSuggestion[];
}

// Minimal shape read from `inventory_items` for the PO-form item picker
// (select('id, name, unit')).
export interface InventoryItemBrief {
  id: string;
  name: string;
  unit: string;
}
