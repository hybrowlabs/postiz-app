import { fetchMediaMetadata } from '../media.metadata';

describe('metadata for method-bound S3 signatures', () => {
  const saved = { ...process.env };
  const originalFetch = global.fetch;
  const url = 'https://bucket.example/video.mp4?X-Amz-Signature=get-only';
  let cancel: jest.Mock;
  let fetchMock: jest.Mock;
  beforeEach(() => {
    process.env.STORAGE_PROVIDER = 'cloudflare';
    process.env.STORAGE_PRIVATE = 'true';
    process.env.CLOUDFLARE_BUCKET_URL = 'https://bucket.example';
    cancel = jest.fn(async () => {});
    fetchMock = jest.fn(async () => ({ status: 206, headers: new Headers({ 'content-range': 'bytes 0-0/123456', 'content-length': '1', 'content-type': 'video/mp4' }), body: { cancel } }));
    global.fetch = fetchMock;
  });
  afterAll(() => { process.env = saved; global.fetch = originalFetch; });
  it('uses the signed GET method and reports total size, not the one-byte range', async () => {
    const dispatcher = {};
    const response = await fetchMediaMetadata(url, { dispatcher });
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
    expect(fetchMock.mock.calls[0][1].headers.get('range')).toBe('bytes=0-0');
    expect(fetchMock.mock.calls[0][1].dispatcher).toBe(dispatcher);
    expect(response.ok).toBe(true);
    expect(response.headers.get('content-length')).toBe('123456');
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(cancel).toHaveBeenCalled();
  });
  it('cancels a full response when a store ignores Range', async () => {
    fetchMock.mockResolvedValue({ status: 200, headers: new Headers({ 'content-length': '123456' }), body: { cancel } });
    expect((await fetchMediaMetadata(url)).headers.get('content-length')).toBe('123456');
    expect(cancel).toHaveBeenCalled();
  });
  it('preserves errors and rejects incomplete range metadata', async () => {
    fetchMock.mockResolvedValueOnce({ status: 403, headers: new Headers(), body: { cancel } });
    expect((await fetchMediaMetadata(url)).status).toBe(403);
    fetchMock.mockResolvedValueOnce({ status: 206, headers: new Headers({ 'content-length': '1' }), body: { cancel } });
    await expect(fetchMediaMetadata(url)).rejects.toThrow('Content-Range');
  });
  it('retains HEAD for public storage and unrelated URLs', async () => {
    await fetchMediaMetadata('https://external.example/video.mp4');
    expect(fetchMock.mock.calls[0][1].method).toBe('HEAD');
    process.env.STORAGE_PRIVATE = 'false';
    await fetchMediaMetadata(url);
    expect(fetchMock.mock.calls[1][1].method).toBe('HEAD');
  });
});
