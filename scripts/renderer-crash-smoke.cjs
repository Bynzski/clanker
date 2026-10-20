// Deliberate crash of a disposable built Electron renderer. Uses the real native
// recovery dialog and Crashpad; never crashes an existing Clanker instance.
const { _electron: electron } = require('playwright');
const { createSmokeOwner, cleanupSmokeFixture } = require('./lib/smoke-fixture-cleanup.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  const deadline = Date.now() + 60000;
  while (!await check()) {
    if (Date.now() > deadline) throw new Error(label);
    await pause(50);
  }
}

async function run() {
  assert(process.platform === 'linux' && process.env.DISPLAY,
    'Native crash-dialog smoke requires Linux/X11 (DISPLAY) and xdotool');
  execFileSync('xdotool', ['version'], { timeout: 2000, stdio: 'ignore' });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-renderer-crash-'));
  const owner = createSmokeOwner();
  for (const name of ['home', 'config', 'cache', 'data', 'profile']) fs.mkdirSync(path.join(root, name));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    ['PATH', 'DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG', 'LC_ALL'].includes(key)));
  Object.assign(env, { [owner.key]: owner.value, NODE_ENV: 'production', ELECTRON_RUN_AS_NODE: '',
    HOME: path.join(root, 'home'), XDG_CONFIG_HOME: path.join(root, 'config'),
    XDG_CACHE_HOME: path.join(root, 'cache'), XDG_DATA_HOME: path.join(root, 'data'),
    CLANKER_CRASH_DUMPS: '1', SHELL: '/bin/bash' });
  let app;
  let passed = false;
  try {
    app = await electron.launch({ executablePath: path.join(repo, 'node_modules/electron/dist/electron'),
      args: [repo, `--user-data-dir=${path.join(root, 'profile')}`, '--ozone-platform=x11', '--disable-gpu'], env });
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Open Workspace', exact: true }).first().waitFor();
    await page.waitForLoadState('load');
    await until(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
      'Fixture window did not become visible');
    const dumps = await app.evaluate(({ app, dialog, BrowserWindow }) => {
      const original = dialog.showMessageBox.bind(dialog);
      globalThis.__crashSmoke = { prompts: 0, buttons: null, response: null, reloads: 0, reason: null };
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      contents.on('render-process-gone', (_event, details) => { globalThis.__crashSmoke.reason = details.reason; });
      contents.on('did-finish-load', () => { globalThis.__crashSmoke.reloads++; });
      // Observe the actual native call, without mocking its dialog or response.
      dialog.showMessageBox = (...args) => {
        const options = args.at(-1);
        if (options.title === 'Clanker Grid renderer stopped') {
          globalThis.__crashSmoke.prompts++;
          globalThis.__crashSmoke.buttons = options.buttons;
          return original(...args).then(result => {
            globalThis.__crashSmoke.response = result.response;
            return result;
          });
        }
        return original(...args);
      };
      return app.getPath('crashDumps');
    });
    const relativeDumps = path.relative(root, dumps);
    assert(relativeDumps && relativeDumps !== '..' && !relativeDumps.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativeDumps), 'Crashpad must write inside the disposable profile');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
    await until(() => app.evaluate(() => globalThis.__crashSmoke.prompts === 1), 'Native recovery prompt missing');
    assert.deepEqual(await app.evaluate(() => globalThis.__crashSmoke.buttons), ['Reload window', 'Not now']);
    let dialogId;
    await until(() => {
      try {
        dialogId = execFileSync('xdotool', ['search', '--onlyvisible', '--pid', String(app.process().pid),
          '--name', '^Clanker Grid renderer stopped$'], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] })
          .trim().split('\n').at(-1);
        return /^\d+$/.test(dialogId);
      } catch { return false; }
    }, 'Fixture native dialog window missing');
    execFileSync('xdotool', ['windowfocus', '--sync', dialogId], { timeout: 2000, stdio: 'ignore' });
    execFileSync('xdotool', ['key', '--window', dialogId, 'Return'], { timeout: 2000, stdio: 'ignore' });
    await until(() => app.evaluate(() => globalThis.__crashSmoke.response === 0), 'Native Reload choice not accepted');
    await until(async () => {
      try {
        return await app.evaluate(async ({ BrowserWindow }) => {
          const contents = BrowserWindow.getAllWindows()[0].webContents;
          return !contents.isCrashed() && await contents.executeJavaScript(
            "Array.from(document.querySelectorAll('button')).some(button => button.textContent.includes('Open Workspace'))");
        });
      } catch { return false; }
    }, 'Reload did not restore the app shell');
    await until(() => app.evaluate(() => globalThis.__crashSmoke.reloads === 1), 'Recovery load did not finish');
    const listDumps = directory => fs.existsSync(directory)
      ? fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(directory, entry.name);
        return entry.isDirectory() ? listDumps(file) : entry.isFile() && entry.name.endsWith('.dmp') ? [file] : [];
      }) : [];
    await until(() => listDumps(dumps).length > 0, 'Local Crashpad minidump missing');
    const sizes = listDumps(dumps).map(file => {
      const header = Buffer.alloc(4);
      const fd = fs.openSync(file, 'r');
      try { fs.readSync(fd, header, 0, 4, 0); } finally { fs.closeSync(fd); }
      assert.equal(header.toString('ascii'), 'MDMP', 'Invalid minidump signature');
      const size = fs.statSync(file).size;
      assert(size > 32, 'Minidump lacks a complete header');
      return size;
    });
    const observed = await app.evaluate(() => globalThis.__crashSmoke);
    assert.equal(observed.prompts, 1);
    assert.equal(observed.reloads, 1);
    assert.equal(observed.reason, 'crashed');
    console.log(JSON.stringify({ nativeRendererCrash: 'passed', nativeDialog: 'Reload accepted',
      restoredShell: 'passed', reloads: observed.reloads, localMinidumps: sizes.length, dumpBytes: sizes,
      crashCause: 'deliberately injected; no claim about #196 root cause', display: 'X11' }));
    passed = true;
  } finally {
    await cleanupSmokeFixture({ app, repo, owner, workspaceRoots: [] });
    // Failed runs retain private evidence; successful runs remove their own dumps.
    if (passed) fs.rmSync(root, { recursive: true, force: true });
    else console.error(`Private failed crash fixture retained at ${root}`);
  }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
