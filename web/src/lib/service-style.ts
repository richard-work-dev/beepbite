export type ServiceStyle = 'dine_in' | 'takeaway';

export function normalizeServiceStyle(value: unknown): ServiceStyle | null {
  return value === 'dine_in' || value === 'takeaway' ? value : null;
}
