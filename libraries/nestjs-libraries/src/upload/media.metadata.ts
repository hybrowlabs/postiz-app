import { privateMediaKey } from './private.media';

/** S3 signatures bind the HTTP method. A signed GET cannot authorize HEAD.
 * Read one byte instead and expose the full size from Content-Range. */
export async function fetchMediaMetadata(
  url: string,
  options: RequestInit & { dispatcher?: unknown } = {},
): Promise<Response> {
  if (!privateMediaKey(url)) return fetch(url, { ...options, method: 'HEAD' });
  const headers = new Headers(options.headers);
  headers.set('range', 'bytes=0-0');
  headers.set('accept-encoding', 'identity');
  const response = await fetch(url, { ...options, method: 'GET', headers });
  const metadata = new Headers(response.headers);
  // Cancel immediately even if the server ignores Range; never buffer a video.
  await response.body?.cancel();
  if (response.status === 206) {
    const total = /^bytes 0-0\/(\d+)$/.exec(metadata.get('content-range') || '')?.[1];
    if (!total || Number(total) <= 0) throw new Error('Invalid private media Content-Range');
    metadata.set('content-length', total);
    metadata.delete('content-range');
  }
  return new Response(null, {
    status: response.status === 206 ? 200 : response.status,
    statusText: response.statusText,
    headers: metadata,
  });
}
