// datarights.js — service helpers for Wave 31 data-rights endpoints.

import { api } from '@/lib/api-client';

export interface StatusMessage {
  status: string;
  message: string;
}

export interface DataExportResult {
  job: unknown;
  archive: unknown;
}

/**
 * Request a tenant-scoped JSON export. The archive is returned inline up to
 * the API's 4 MB response limit.
 */
export async function requestDataExport() {
  return api.request<DataExportResult>('POST', '/settings/data-export');
}

/** Request irreversible tenant deletion after typing the exact organization name. */
export async function requestOrganizationPurge(organizationName: string) {
  return api.request<StatusMessage>('DELETE', '/settings/account', {
    body: { confirm: true, organization_name: organizationName },
  });
}

/**
 * Redact PII for a specific customer (right-to-be-forgotten).
 * Order history is retained anonymised.
 *
 * @param customerId  UUID of the customer to forget.
 */
export async function forgetCustomer(customerId: string) {
  return api.request<StatusMessage>('POST', `/customers/${customerId}/forget`);
}
