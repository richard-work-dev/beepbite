// tracking.js — public order-tracking service.
// The /track/{token} endpoint is token-scoped and does NOT require a bearer
// token — the tracking token itself is the access key. We pass auth:false so
// no Authorization header is attached.

import { api } from '@/lib/api-client';

/**
 * Raw response shape returned by GET /track/{token}
 * (see backend/internal/handlers/tracking/store.go — OrderInfo):
 * {
 *   token: string, order_id: string,
 *   status: 'pending'|'confirmed'|'preparing'|'ready'|'out_for_delivery'
 *         |'delivered'|'completed'|'cancelled',
 *   fulfillment_type: string,
 *   estimated_delivery_time?: string,      // ISO timestamp, nullable
 *   store_lat?: number, store_lng?: number,
 *   delivery_address?: string,             // text label, always present when set
 *   delivery_lat?: number, delivery_lng?: number,  // only once out_for_delivery
 *   driver?: { lat: number, lng: number, recorded_at: string }
 * }
 *
 * The UI (track/index.tsx and friends) wants a friendlier normalised shape:
 * { status, eta_minutes, store: {lat,lng}|null,
 *   delivery_address: {lat,lng,label}|null, driver }
 * normalizeTracking() bridges the two so the page never has to know about
 * the flat wire format.
 */
type TrackingStatus =
  | 'pending' | 'pending_on_delivery' | 'sent' | 'confirmed' | 'preparing' | 'ready' | 'out_for_delivery'
  | 'delivered' | 'completed' | 'cancelled';

interface RawTracking {
  order_number?: string;
  total_cents?: number;
  currency_code?: string;
  locale?: string;
  store_name?: string;
  store_address?: string;
  store_slug?: string;
  payment_status?: string;
  payment_method?: string;
  transfer_details?: { account_holder: string; alias?: string; cbu?: string };
  store_whatsapp_number?: string;
  phone_country_code?: string;
  table_label?: string;
  estimated_prep_time_minutes?: number;
  items?: { name: string; quantity: number; total_cents: number; notes?: string }[];
  token: string;
  order_id: string;
  status: TrackingStatus;
  fulfillment_type: string;
  estimated_delivery_time?: string;
  store_lat?: number;
  store_lng?: number;
  delivery_address?: string;
  delivery_lat?: number;
  delivery_lng?: number;
  driver?: { lat: number; lng: number; recorded_at: string };
}

export interface TrackingPayload {
  orderNumber?: string;
  totalCents?: number;
  currency?: string;
  locale?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  transferDetails?: { account_holder: string; alias?: string; cbu?: string };
  tableLabel?: string;
  prepMinutes?: number;
  items?: { name: string; quantity: number; total_cents: number; notes?: string }[];
  status: TrackingStatus;
  fulfillmentType: string;
  eta_minutes: number | null;
  store: { lat?: number; lng?: number; name?: string; address?: string; slug?: string; whatsapp_number?: string; phone_country_code?: string } | null;
  delivery_address: { lat: number | null; lng: number | null; label: string | null };
  driver: { lat: number; lng: number } | null;
}

function normalizeTracking(raw: RawTracking | null): TrackingPayload | null {
  if (!raw) return raw;

  const hasStoreCoords = raw.store_lat != null && raw.store_lng != null;
  const hasDeliveryCoords = raw.delivery_lat != null && raw.delivery_lng != null;

  let etaMinutes = null;
  if (raw.estimated_delivery_time) {
    const diffMs = new Date(raw.estimated_delivery_time).getTime() - Date.now();
    if (Number.isFinite(diffMs)) etaMinutes = Math.max(0, Math.round(diffMs / 60000));
  }

  return {
    orderNumber: raw.order_number, totalCents: raw.total_cents, currency: raw.currency_code,
    locale: raw.locale, paymentStatus: raw.payment_status, paymentMethod: raw.payment_method,
    transferDetails: raw.transfer_details,
    tableLabel: raw.table_label, prepMinutes: raw.estimated_prep_time_minutes, items: raw.items,
    status: raw.status,
    fulfillmentType: raw.fulfillment_type,
    eta_minutes: etaMinutes,
    // The backend never sends a store name/address — only coordinates — so
    // there's no name/address field to carry through here.
    store: hasStoreCoords || raw.store_name ? { lat: raw.store_lat, lng: raw.store_lng, name: raw.store_name, address: raw.store_address, slug: raw.store_slug, whatsapp_number: raw.store_whatsapp_number, phone_country_code: raw.phone_country_code } : null,
    delivery_address: {
      lat: hasDeliveryCoords ? raw.delivery_lat ?? null : null,
      lng: hasDeliveryCoords ? raw.delivery_lng ?? null : null,
      label: raw.delivery_address || null,
    },
    driver: raw.driver ? { lat: raw.driver.lat, lng: raw.driver.lng } : null,
  };
}

/**
 * Fetch live tracking data for an order by its tracking token.
 *
 * @param token  — URL-safe tracking token from the customer link
 */
export async function fetchTracking(token: string) {
  if (!token) {
    return { data: null, error: { message: 'No tracking token provided', status: 400 } };
  }
  const { data, error } = await api.request<RawTracking>('GET', `/track/${encodeURIComponent(token)}`, { auth: false });
  if (error) return { data: null, error };
  return { data: normalizeTracking(data), error: null };
}
