import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestMock = vi.fn();
vi.mock('@/lib/api-client', () => ({
  api: { request: (...args: unknown[]) => requestMock(...args) },
}));

const { fetchStoreReviews } = await import('../services/reviews.js');

beforeEach(() => {
  requestMock.mockReset();
});

describe('fetchStoreReviews', () => {
  it('unwraps the paginated backend envelope for the store UI', async () => {
    const review = { id: 'review-1', stars: 5, text: 'Great', photos: [], created_at: '2026-09-24T10:00:00Z' };
    requestMock.mockResolvedValue({ data: { data: [review], limit: 20 }, error: null });

    const result = await fetchStoreReviews('my store', 20);

    expect(requestMock).toHaveBeenCalledWith('GET', '/stores/my%20store/reviews?limit=20', { auth: false });
    expect(result).toEqual({ data: [review], error: null });
  });

  it('keeps compatibility with a direct review array', async () => {
    const review = { id: 'review-2', stars: 4, photos: [], created_at: '2026-09-24T11:00:00Z' };
    requestMock.mockResolvedValue({ data: [review], error: null });

    expect(await fetchStoreReviews('shop')).toEqual({ data: [review], error: null });
  });

  it('propagates API errors', async () => {
    requestMock.mockResolvedValue({ data: null, error: { message: 'store not found', status: 404 } });

    expect(await fetchStoreReviews('missing')).toEqual({ data: null, error: { message: 'store not found', status: 404 } });
  });
});
