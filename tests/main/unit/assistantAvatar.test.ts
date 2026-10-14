import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { nativeImage } from 'electron';
import { decodeAvatar, parseAssistantAvatar, UnsupportedAvatarFormat } from '../../../src/main/assistants/assistantAvatar';

vi.mock('electron', () => ({ nativeImage: { createFromBuffer: vi.fn() } }));
let png: Buffer; let jpeg: Buffer; let webp: Buffer;
beforeAll(async () => {
  const image = () => sharp({ create: { width: 32, height: 16, channels: 4, background: '#8090a0' } });
  png = await image().png().toBuffer(); jpeg = await image().jpeg().toBuffer(); webp = await image().webp().toBuffer();
});
beforeEach(() => vi.clearAllMocks());
const envelope = (bytes: Buffer, mime = 'image/png') => ({ found: true, mime, size: bytes.length, data: `data:${mime};base64,${bytes.toString('base64')}` });
const decoder = () => vi.fn(() => ({ bytes: png, width: 32, height: 16 }));

describe('bounded native avatar projection', () => {
  it('accepts missing art without decoding and discards extra backend fields', () => {
    const decode = decoder();
    expect(parseAssistantAvatar({ found: false, path: '/private', token: 'private' }, decode)).toEqual({ state: 'ready', data: null });
    expect(decode).not.toHaveBeenCalled();
  });
  it.each(['png', 'jpeg'])('validates %s and returns only a normalized PNG thumbnail', (format) => {
    const input = format === 'jpeg' ? jpeg : png;
    const decode = decoder();
    const result = parseAssistantAvatar({ ...envelope(input, `image/${format}`), path: '/home/private', extra: 'secret' }, decode);
    expect(decode).toHaveBeenCalledWith(input, { width: 32, height: 16 });
    expect(result).toEqual({ state: 'ready', data: { dataUrl: `data:image/png;base64,${png.toString('base64')}`, width: 32, height: 16 } });
    expect(JSON.stringify(result)).not.toMatch(/private|secret/);
  });
  it('accepts progressive JPEG headers through the same bounds', async () => {
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#405060' } }).jpeg({ progressive: true }).toBuffer();
    const decode = decoder(); parseAssistantAvatar(envelope(bytes, 'image/jpeg'), decode);
    expect(decode).toHaveBeenCalledWith(bytes, { width: 8, height: 8 });
  });
  it('classifies native WebP assets as unsupported without relying on an unverified decoder', () => {
    const decode = decoder();
    expect(() => parseAssistantAvatar(envelope(webp, 'image/webp'), decode)).toThrow(UnsupportedAvatarFormat);
    expect(decode).not.toHaveBeenCalled();
  });
  it.each([null, {}, { found: 'yes' }, { found: true, mime: 'image/svg+xml' }, { found: true, mime: 'image/gif' }])('rejects malformed/unsupported envelope %j', (value) => {
    const decode = decoder(); expect(() => parseAssistantAvatar(value, decode)).toThrow(); expect(decode).not.toHaveBeenCalled();
  });
  it('rejects MIME/signature mismatch, invalid/noncanonical base64, wrong reported size and arbitrary URLs', () => {
    const valid = envelope(png); const decode = decoder();
    for (const value of [envelope(png, 'image/jpeg'), { ...valid, data: 'https://untrusted/avatar.png' },
      { ...valid, size: valid.size + 1 }, { ...valid, data: valid.data + '\n' }, { ...valid, data: 'data:image/png;base64,AB==' },
      { ...valid, data: 'data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64') }]) expect(() => parseAssistantAvatar(value, decode)).toThrow();
    expect(decode).not.toHaveBeenCalled();
  });
  it('bounds encoded bytes and dimension bombs before invoking the image decoder', () => {
    const decode = decoder(); const large = Buffer.from(png); large.writeUInt32BE(100000, 16);
    for (const value of [{ ...envelope(png), size: 2_000_001 }, { ...envelope(png), data: `data:image/png;base64,${'A'.repeat(2_666_669)}` }, envelope(large), envelope(Buffer.alloc(10))]) {
      expect(() => parseAssistantAvatar(value, decode)).toThrow();
    }
    expect(decode).not.toHaveBeenCalled();
  });
  it('rejects an oversized, non-PNG or invalid decoded thumbnail', () => {
    for (const output of [{ bytes: Buffer.alloc(128 * 1024 + 1), width: 32, height: 16 }, { bytes: jpeg, width: 32, height: 16 },
      { bytes: png, width: 129, height: 16 }, { bytes: png, width: 0, height: 16 }]) {
      expect(() => parseAssistantAvatar(envelope(png), () => output)).toThrow();
    }
    expect(() => parseAssistantAvatar(envelope(png), () => { throw new Error('unsupported codec'); })).toThrow();
  });
  it('native decoding checks actual dimensions and re-encodes a 128px thumbnail', () => {
    const resize = vi.fn(() => ({ toPNG: () => png, getSize: () => ({ width: 128, height: 64 }) }));
    vi.mocked(nativeImage.createFromBuffer).mockReturnValue({ isEmpty: () => false, getSize: () => ({ width: 512, height: 256 }), resize } as never);
    expect(decodeAvatar(png, { width: 512, height: 256 })).toEqual({ bytes: png, width: 128, height: 64 });
    expect(resize).toHaveBeenCalledWith({ width: 128, height: 64, quality: 'good' });
    expect(() => decodeAvatar(png, { width: 1, height: 1 })).toThrow();
    vi.mocked(nativeImage.createFromBuffer).mockReturnValue({ isEmpty: () => true, getSize: () => ({ width: 0, height: 0 }) } as never);
    expect(() => decodeAvatar(png, { width: 32, height: 16 })).toThrow();
  });
});
