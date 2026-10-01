const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { generate } = require('./generate-branding.cjs');

const root = path.join(__dirname, '../src/assets/branding');

async function checkBranding(sourceRoot = root, temporaryParent = os.tmpdir()) {
  const temporary = await fs.mkdtemp(path.join(temporaryParent, 'clanker-branding-check-'));
  try {
    await generate(sourceRoot, temporary);
    const committed = path.join(sourceRoot, 'generated');
    const expected = (await fs.readdir(temporary)).sort();
    let actual;
    try {
      actual = await fs.readdir(committed);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      actual = [];
    }
    const differences = actual.filter((name) => !expected.includes(name))
      .sort().map((name) => `unexpected: ${name}`);
    for (const name of expected) {
      if (!actual.includes(name)) {
        differences.push(`missing: ${name}`);
        continue;
      }
      const entry = await fs.lstat(path.join(committed, name));
      if (!entry.isFile()) {
        differences.push(`not a regular file: ${name}`);
        continue;
      }
      const [generated, checkedIn] = await Promise.all([
        fs.readFile(path.join(temporary, name)), fs.readFile(path.join(committed, name)),
      ]);
      if (!generated.equals(checkedIn)) differences.push(`changed: ${name}`);
    }
    if (differences.length) {
      throw new Error(`Branding assets are out of date:\n${differences.join('\n')}\n`
        + 'Run npm run branding:generate, remove unexpected entries, then review and commit the generated assets.');
    }
    return expected.length;
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

module.exports = { checkBranding };

if (require.main === module) {
  checkBranding().then((count) => {
    console.log(`Branding check passed: ${count} generated assets match canonical sources (working tree unchanged).`);
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
