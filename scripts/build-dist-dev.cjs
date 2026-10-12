const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function getGitCommitSha(cwd = process.cwd(), length = 7) {
  try {
    const stdout = execFileSync('git', ['rev-parse', `--short=${length}`, 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (stdout) return stdout;
  } catch {
    // Git unavailable or not in a git repo
  }
  return null;
}

function computeDevVersion({ cwd = process.cwd(), shaLength = 7 } = {}) {
  const pkgPath = path.join(cwd, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const baseVersion = pkg.version || '0.0.0';
  const sha = getGitCommitSha(cwd, shaLength) || 'unknown';
  return `${baseVersion}-dev.${sha}`;
}

function resolveElectronBuilderBin(cwd = process.cwd()) {
  const localBin = path.join(
    cwd,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder'
  );
  if (fs.existsSync(localBin)) {
    return localBin;
  }
  return 'electron-builder';
}

function runDevBuild() {
  const devVersion = computeDevVersion({ cwd: process.cwd() });
  console.log(`[build:dist:dev] Packaging dev build with version: ${devVersion}`);

  const userArgs = process.argv.slice(2);
  const electronBuilderBin = resolveElectronBuilderBin(process.cwd());

  const args = [
    '--publish',
    'never',
    `-c.extraMetadata.version=${devVersion}`,
    ...userArgs,
  ];

  const result = spawnSync(electronBuilderBin, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    console.error('[build:dist:dev] Failed to execute electron-builder:', result.error.message);
    process.exit(1);
  }

  process.exit(result.status ?? 0);
}

if (require.main === module) {
  runDevBuild();
}

module.exports = {
  getGitCommitSha,
  computeDevVersion,
  resolveElectronBuilderBin,
};
