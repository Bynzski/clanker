import { nativeImage } from 'electron';
import type { AssistantAvatar } from '../../shared/types/assistantPresentation';
import { record } from './assistantDetails';

const MAX_ASSET_BYTES = 2_000_000; // Hermes' native limit, not 2 MiB.
const MAX_ENCODED_LENGTH = 4 * Math.ceil(MAX_ASSET_BYTES / 3);
const MAX_DIMENSION = 2048;
const MAX_THUMBNAIL_BYTES = 128 * 1024;
interface Dimensions { width: number; height: number }
export class UnsupportedAvatarFormat extends Error {}
export type AvatarDecoder = (bytes: Buffer, dimensions: Dimensions) => { bytes: Buffer; width: number; height: number };

function validSize(size: Dimensions): boolean {
  return size.width > 0 && size.height > 0 && size.width <= MAX_DIMENSION && size.height <= MAX_DIMENSION;
}
/** Inspect dimensions before invoking a decoder; compressed image bombs must not allocate huge bitmaps. */
function imageSize(bytes: Buffer, mime: string): Dimensions {
  if (mime === 'image/png' && bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
    bytes.readUInt32BE(8) === 13 && bytes.toString('ascii', 12, 16) === 'IHDR') {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (mime === 'image/jpeg' && bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9 || marker === undefined) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
        return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
      }
      offset += length;
    }
  }
  throw new Error('Unsupported or malformed image');
}

/** Electron's documented PNG/JPEG decoder is the final authority. Never forward original asset bytes. */
export const decodeAvatar: AvatarDecoder = (bytes, dimensions) => {
  const image = nativeImage.createFromBuffer(bytes);
  const size = image.getSize();
  if (image.isEmpty() || size.width !== dimensions.width || size.height !== dimensions.height) throw new Error('Invalid image');
  const ratio = Math.min(1, 128 / Math.max(size.width, size.height));
  const thumbnail = image.resize({ width: Math.max(1, Math.round(size.width * ratio)), height: Math.max(1, Math.round(size.height * ratio)), quality: 'good' });
  return { bytes: thumbnail.toPNG(), ...thumbnail.getSize() };
};

/** Exact get_asset envelope, MIME, canonical base64, signature, size and decoded dimensions are all checked. */
export function parseAssistantAvatar(value: unknown, decode: AvatarDecoder = decodeAvatar): AssistantAvatar {
  const row = record(value);
  if (row.found === false) return { state: 'ready', data: null };
  if (row.found !== true || typeof row.mime !== 'string' || !['image/png', 'image/jpeg', 'image/webp'].includes(row.mime) ||
    !Number.isSafeInteger(row.size) || (row.size as number) <= 0 || (row.size as number) > MAX_ASSET_BYTES || typeof row.data !== 'string') throw new Error('Invalid asset');
  const prefix = `data:${row.mime};base64,`;
  if (!row.data.startsWith(prefix) || row.data.length > prefix.length + MAX_ENCODED_LENGTH) throw new Error('Invalid asset');
  const encoded = row.data.slice(prefix.length);
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('Invalid asset');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length !== row.size || bytes.toString('base64') !== encoded) throw new Error('Invalid asset');
  // Hermes supports WebP, but Electron 41 nativeImage does not. No speculative codec dependency or renderer decode.
  if (row.mime === 'image/webp') throw new UnsupportedAvatarFormat();
  const dimensions = imageSize(bytes, row.mime);
  if (!validSize(dimensions)) throw new Error('Invalid dimensions');
  const thumbnail = decode(bytes, dimensions);
  if (!thumbnail.bytes.length || thumbnail.bytes.length > MAX_THUMBNAIL_BYTES || thumbnail.width < 1 || thumbnail.height < 1 ||
    thumbnail.width > 128 || thumbnail.height > 128 || !thumbnail.bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error('Invalid thumbnail');
  return { state: 'ready', data: { dataUrl: `data:image/png;base64,${thumbnail.bytes.toString('base64')}`, width: thumbnail.width, height: thumbnail.height } };
}
