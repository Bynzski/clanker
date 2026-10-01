// Build-time only: npm run branding:generate. Originals are never overwritten.
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const root = path.join(__dirname, '../src/assets/branding');
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

async function resize(sourceRoot, output, source, size, destination, extract) {
  let image = sharp(path.join(sourceRoot, source));
  if (extract) image = image.extract(extract);
  const png = await image.resize(size, size, {
    fit: 'contain', background: '#00000000', kernel: sharp.kernel.lanczos3,
  }).png({ compressionLevel: 9 }).toBuffer();
  await fs.writeFile(path.join(output, destination), png);
  return png;
}

async function generate(sourceRoot = root, output = path.join(sourceRoot, 'generated')) {
  await fs.mkdir(output, { recursive: true });
  const app = new Map();
  for (const size of sizes) {
    app.set(size, await resize(sourceRoot, output, 'clanker-app-icon.png', size, `clanker-app-${size}.png`));
  }
  // Remove excess transparent margin around the compact mark, retaining the
  // complete rounded frame and padding. No stretching or artwork repainting.
  for (const size of [16, 18, 20, 24, 32, 36, 40, 48]) {
    await resize(sourceRoot, output, 'clanker-ui-icon.png', size, `clanker-ui-${size}.png`, {
      left: 125, top: 125, width: 1004, height: 1004,
    });
  }

  // ICO directory with PNG payloads: supported by all supported Windows versions.
  const icoSizes = sizes.filter((size) => size <= 256);
  const header = Buffer.alloc(6 + icoSizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(icoSizes.length, 4);
  let offset = header.length;
  icoSizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    const png = app.get(size);
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  await fs.writeFile(path.join(output, 'clanker-app.ico'),
    Buffer.concat([header, ...icoSizes.map((size) => app.get(size))]));

  // Modern ICNS PNG chunks; no macOS-only iconutil dependency needed.
  const chunks = [[16, 'icp4'], [32, 'icp5'], [64, 'icp6'], [128, 'ic07'],
    [256, 'ic08'], [512, 'ic09'], [1024, 'ic10']].map(([size, type]) => {
    const png = app.get(size);
    const chunk = Buffer.alloc(8);
    chunk.write(type);
    chunk.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([chunk, png]);
  });
  const icns = Buffer.alloc(8);
  icns.write('icns');
  icns.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
  await fs.writeFile(path.join(output, 'clanker-app.icns'), Buffer.concat([icns, ...chunks]));
}

module.exports = { generate };

if (require.main === module) {
  generate().then(() => {
    console.log('Generated Clanker application and compact UI icons.');
  }).catch((error) => { console.error(error); process.exitCode = 1; });
}
