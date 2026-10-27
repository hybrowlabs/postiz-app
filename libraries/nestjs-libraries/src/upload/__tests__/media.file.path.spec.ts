import { mediaFilePath } from '../media.file.path';
import { lookup } from 'mime-types';
import { getType } from 'mime';

describe('signed media MIME types and filenames', () => {
  it.each([['gif', 'image/gif'], ['png', 'image/png'], ['jpg', 'image/jpeg'], ['mp4', 'video/mp4']])('preserves %s detection for LinkedIn, Telegram and other providers', (ext, type) => {
    const signed = `https://bucket.example/asset.${ext}?X-Amz-Signature=secret#preview`;
    const file = mediaFilePath(signed);
    expect(lookup(file)).toBe(type);
    expect(getType(file)).toBe(type);
    expect(file.split('/').pop()).toBe(`asset.${ext}`);
    expect(signed).toContain('X-Amz-Signature=secret');
  });
  it('keeps ordinary URLs and local file paths intact', () => {
    expect(mediaFilePath('/uploads/local.png')).toBe('/uploads/local.png');
    expect(mediaFilePath('https://public.example/file.gif')).toBe('https://public.example/file.gif');
  });
});
