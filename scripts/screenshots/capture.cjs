/* global window */
// Real Electron/UI captures. No mocked bridge, credentials, or injected app styles.
const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { execFileSync } = require('node:child_process');
const { createProject } = require('./fixture.cjs');
const { stopOwnedCodexDaemons } = require('./cleanup.cjs');
const repo = path.resolve(__dirname, '../..');
const date = process.env.CAPTURE_DATE || new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('CAPTURE_DATE must be YYYY-MM-DD');
const themes = (process.env.CAPTURE_THEMES || 'dark,light,slate').split(',');
if (themes.some(t => !['dark', 'light', 'slate'].includes(t))) throw new Error('Invalid CAPTURE_THEMES');
const clips = !process.argv.includes('--no-clips');
const previewOnly = process.argv.includes('--preview-only');
if (clips) execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-capture-'));
const out = path.join(repo, 'docs/screenshots', date + '-features');
fs.mkdirSync(out, { recursive: true });
const html = fs.readFileSync(path.join(__dirname, 'preview.html'), 'utf8');
const projects = Object.fromEntries(['northstar-app', 'acme-api', 'docs-site'].map(name => [name, createProject(root, name, html)]));
for (const d of ['home', 'config', 'cache', 'data']) fs.mkdirSync(path.join(root, d));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG', 'LC_ALL', 'TZ'].includes(key)));
Object.assign(env, { NODE_ENV: 'production', ELECTRON_RUN_AS_NODE: '', HOME: path.join(root, 'home'), XDG_CONFIG_HOME: path.join(root, 'config'), XDG_CACHE_HOME: path.join(root, 'cache'), XDG_DATA_HOME: path.join(root, 'data'), SHELL: '/bin/bash', PS1: 'demo $ ', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' });
const entries = [];
let app, page;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const button = name => page.getByRole('button', { name, exact: true });
async function click(name) { await button(name).first().click(); }
async function openWorkspace(name) {
  await click('Open Workspace');
  await page.getByRole('textbox', { name: 'Local Directory Path' }).fill(projects[name]);
  await page.getByRole('dialog').getByText('Where are we working today?').click();
  await page.getByRole('dialog').getByRole('button', { name: /^Open(?: Workspace)?$/ }).click();
  await button('Terminal').waitFor();
  await pause(1000);
}
async function launch(name) { await click(name); await page.locator('.xterm-screen:visible').last().waitFor(); await pause(1800); }
async function pixels(requireBrowser = false) {
  const base = await page.screenshot();
  const views = await app.evaluate(async ({ BrowserWindow }) => {
    const result = [];
    for (const view of BrowserWindow.getAllWindows()[0].contentView.children) {
      if (!view.webContents || !/^http:\/\/127\.0\.0\.1:/.test(view.webContents.getURL())) continue;
      const bounds = view.getBounds();
      if (bounds.width <= 0 || bounds.height <= 0 || !view.getVisible()) continue;
      result.push({ bounds, png: (await view.webContents.capturePage()).toPNG().toString('base64') });
    }
    return result;
  });
  if (requireBrowser && views.length !== 1) throw new Error(`Expected one visible native preview, got ${views.length}`);
  return sharp(base).composite(views.map(v => ({ input: Buffer.from(v.png, 'base64'), left: v.bounds.x, top: v.bounds.y }))).png().toBuffer();
}
async function shot(theme, scene, description) {
  await pause(450);
  const file = `${theme}-${scene}.png`;
  const image = await pixels(['dev-server-browser', 'editor-browser', 'browser-tabs', 'browser-annotation'].includes(scene));
  const size = await sharp(image).metadata();
  if (size.width !== 1920 || size.height !== 1080) throw new Error('Unexpected capture dimensions');
  fs.writeFileSync(path.join(out, file), image);
  entries.push({ file, description, kind: 'image' });
  console.log('Captured', file);
}
async function clip(theme, scene, description, actions) {
  if (!clips || theme !== themes[0]) return actions();
  const frames = fs.mkdtempSync(path.join(root, 'frames-'));
  let stop = false, failure;
  const timestamps = [];
  const sampling = (async () => {
    while (!stop) {
      const start = Date.now();
      try {
        const image = await pixels();
        const file = path.join(frames, `${timestamps.length}.png`);
        fs.writeFileSync(file, image);
        timestamps.push({ file, time: start });
      } catch (error) { failure = error; break; }
      await pause(Math.max(0, 250 - (Date.now() - start)));
    }
  })();
  try { await pause(1000); await actions(); await pause(1800); }
  finally { stop = true; await sampling; }
  if (failure) throw failure;
  const list = timestamps.map((frame, i) => `file '${frame.file}'\nduration ${((timestamps[i + 1]?.time ?? Date.now()) - frame.time) / 1000}\n`).join('') + `file '${timestamps.at(-1).file}'\n`;
  const seconds = Number(((Date.now() - timestamps[0].time) / 1000).toFixed(1));
  const concat = path.join(frames, 'frames.txt'); fs.writeFileSync(concat, list);
  const file = `${theme}-${scene}.mp4`;
  execFileSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', concat, '-an', '-vf', 'fps=24', '-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(out, file)], { stdio: 'pipe' });
  const posters = {
    'isolated-agent-picker-tour': 'isolated-agent-picker', 'isolated-checkout-launch': 'isolated-checkout-agent',
    'git-menu-tour': 'git-menu', 'usage-status-tour': 'usage-status', 'settings-tour': 'settings',
    'workspace-switching': 'multi-project-agents', 'dev-server-preview': 'dev-server-browser', 'browser-annotation': 'browser-annotation',
  };
  entries.push({ file, description, kind: 'video', seconds, poster: `${theme}-${posters[scene]}.png` });
  fs.rmSync(frames, { recursive: true, force: true });
  console.log('Recorded', file);
}
async function menu(theme, name, scene, description) {
  await clip(theme, `${scene}-tour`, description, async () => {
    await click(name);
    if (name === 'Usage') await page.locator('.usage-harness[aria-busy="true"]').first().waitFor({ state: 'hidden', timeout: 45000 });
    await pause(1600); await shot(theme, scene, description);
    await page.keyboard.press('Escape');
  });
}
function index(error) {
  const manifest = { sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), version: require('../../package.json').version, capturedAt: new Date().toISOString(), dimensions: [1920, 1080], themes, selection: previewOnly ? 'preview-only' : 'all', complete: !error, privacy: 'Isolated profiles; no personal credentials or model prompts. Real harness onboarding, not active AI work. Usage is unauthenticated.', entries, ...(error ? { error: String(error) } : {}) };
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Clanker Grid feature captures</title><style>body{margin:32px;background:#11151c;color:#edf2fa;font:16px system-ui}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:24px}figure{margin:0;background:#1c2330;padding:12px;border-radius:12px}img,video{width:100%;aspect-ratio:16/9;object-fit:contain}figcaption{line-height:1.6}a{color:#a5caff}small{display:block;color:#b6c2d3}</style><h1>Clanker Grid — feature captures</h1><p>${escape(manifest.privacy)} ${error ? 'Incomplete capture run.' : ''}</p><p>Click a still to open its original. Clips have controls and do not autoplay.</p><main>${entries.map(e => `<figure>${e.kind === 'image' ? `<a href="${e.file}"><img loading="lazy" src="${e.file}" alt="${escape(e.description)}"></a>` : `<video controls preload="none" src="${e.file}" poster="${e.poster}" aria-label="${escape(e.description)}"></video>`}<figcaption><a href="${e.file}">${e.file}</a><small>${escape(e.description)}</small></figcaption></figure>`).join('')}</main></html>`);
  fs.writeFileSync(path.join(out, 'README.md'), `# Feature captures — ${date}\n\n${error ? '**Incomplete run:** ' + String(error) + '\n\n' : ''}Clanker Grid ${manifest.version}, source commit \`${manifest.sourceCommit}\`. Real Electron UI, 1920 × 1080. Disposable Git projects with source, tests, history, branches and a linked worktree. No personal profiles, credentials or conversations. Harness panes show actual unauthenticated onboarding—not AI tasks. Usage shows real unauthenticated statuses, not example quotas. Browser pages are real loopback pages composited at native view bounds. Clips are silent, sampled at about four frames per second and encoded at 24 fps.\n\nRegenerate with \`npm run capture:features\`; see [capture tooling](../../../scripts/screenshots/README.md). Site publishing is independent; these assets are not automatically deployed. Keep historical PNGs.\n\n| Asset | Feature / limitations |\n| --- | --- |\n${entries.map(e => `| [${e.file}](${e.file}) | ${e.description} |`).join('\n')}\n`);
}
(async () => {
  for (const theme of themes) {
    const profile = path.join(root, theme); fs.mkdirSync(profile);
    // Some vendor CLIs use OS/shared authentication even with a blank HOME.
    // Only the home-isolated Codex/Claude usage adapters participate in this demo.
    fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify({
      theme, workspaceNavigationMode: 'sidebar',
      harnessDefaults: Object.fromEntries(['codex', 'claude', 'pi', 'opencode', 'omp', 'hermes', 'agy'].map(id => [id, {
        model: '', favorites: [], flags: '', visible: true,
        usageVisible: ['codex', 'claude'].includes(id),
      }])),
    }));
    app = await electron.launch({ executablePath: path.join(repo, 'node_modules/electron/dist/electron'), args: [repo, `--user-data-dir=${profile}`, '--ozone-platform=headless'], env });
    try {
      page = await app.firstWindow(); page.setDefaultTimeout(15000);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1920, 1080));
      await page.waitForLoadState(); await pause(1500);
      await page.evaluate(theme => window.electronAPI.setTheme(theme), theme);
      await page.reload(); await pause(1000);
      await page.evaluate(() => {
        window.captureTerminalIds = [];
        window.electronAPI.onTerminalData(({ id }) => {
          if (!window.captureTerminalIds.includes(id)) window.captureTerminalIds.push(id);
        });
      });
      if (!previewOnly) {
      await shot(theme, 'empty-shell', 'Empty shell and workspace entry points');
      await click('Open Workspace');
      await page.getByRole('textbox', { name: 'Local Directory Path' }).fill(projects['northstar-app']);
      await page.getByRole('dialog').getByText('Where are we working today?').click();
      await shot(theme, 'open-workspace', 'Local workspace chooser; SSH location entry point');
      await page.getByRole('dialog').getByRole('button', { name: /^Open(?: Workspace)?$/ }).click();
      await pause(1200); await launch('Terminal');
      // Run genuine deterministic tests and Git commands in the actual shell.
      await page.locator('.xterm:visible .xterm-helper-textarea').last().focus();
      await page.keyboard.type('clear; printf "Northstar development checks\\n\\n"; npm run test; git log --oneline -3');
      await page.keyboard.press('Enter'); await pause(1800);
      await click('Expand Files');
      await shot(theme, 'files-and-tests', 'Explorer source tree and real passing project tests');
      await page.getByText('src', { exact: true }).last().click(); await pause(400);
      await page.getByText('projects.ts', { exact: true }).dblclick(); await pause(400);
      await shot(theme, 'typescript-editor', 'TypeScript editor pinned to the workspace checkout');
      await page.locator('.tree-node-name').filter({ hasText: /^README\.md$/ }).dblclick(); await click('Preview');
      await page.getByRole('region', { name: 'Markdown preview' }).waitFor();
      await shot(theme, 'markdown-preview', 'Rendered Markdown guide and task checklist in the editor');
      await page.locator('.tree-node-name').filter({ hasText: /^projects\.ts$/ }).dblclick();
      await menu(theme, 'New isolated agent', 'isolated-agent-picker', 'Harness selection, existing branches and a real linked worktree');
      await clip(theme, 'isolated-checkout-launch', 'Creating an isolated branch and launching a real Pi pane (unconfigured model)', async () => {
        await click('New isolated agent');
        await page.getByRole('radio', { name: 'Pi', exact: true }).click();
        await page.getByLabel('New branch', { exact: true }).fill(`feat/keyboard-${theme}`);
        await pause(900); await click('Launch Pi');
        await button('Launch Pi').waitFor({ state: 'hidden', timeout: 30000 });
        await pause(1800); await shot(theme, 'isolated-checkout-agent', 'Real created branch, attached checkout and Pi startup; no model task');
      });
      await button('Close terminal').last().click(); await pause(500);
      await shot(theme, 'inactive-checkout', 'Created checkout stays managed after its last agent closes');
      await clip(theme, 'git-menu-tour', 'Git changes, branches, worktree management and commit history', async () => {
        await page.locator('button.git-btn').click();
        await page.getByRole('menu', { name: 'Git actions' }).waitFor(); await pause(1200);
        await shot(theme, 'git-menu', 'Git menu with dirty files, branches and linked worktree');
        const menu = page.getByRole('menu', { name: 'Git actions' });
        await menu.getByRole('button', { name: 'Working Tree', exact: true }).scrollIntoViewIfNeeded();
        await menu.getByRole('button', { name: 'Working Tree', exact: true }).click(); await pause(1200);
        await shot(theme, 'git-history', 'Git commit history and actual working-copy diff');
        await page.keyboard.press('Escape');
        // Git menu uses outside-click dismissal, rather than a Radix popover.
        if (await menu.isVisible()) await page.locator('button.git-btn').click();
      });
      await page.locator('button.git-btn').click(); await click('Commit Changes');
      await page.getByRole('dialog').waitFor(); await pause(600);
      await shot(theme, 'commit-dialog', 'Commit dialog with real modified and untracked files; no commit submitted');
      await page.keyboard.press('Escape');
      await menu(theme, 'Usage', 'usage-status', 'Usage menu: actual signed-out/unavailable statuses; no fabricated quota');
      await menu(theme, 'Settings', 'settings', 'Settings and appearance controls');
      await click('Toggle notes panel'); await page.getByPlaceholder('Notes…').fill('Northstar launch checklist\n\n✓ Run project tests\n✓ Review API contracts\n→ Build project search in an isolated checkout\n→ Check browser preview and keyboard navigation');
      await shot(theme, 'workspace-notes', 'Workspace notes beside the editor and terminal');
      await click('Close notes');
      await openWorkspace('acme-api'); await launch('Codex');
      await openWorkspace('docs-site'); await launch('Claude');
      await click('northstar-app');
      await click('Close editor'); await launch('Codex'); await launch('Claude'); await launch('Pi');
      await click('Fit all panes'); await pause(700);
      await shot(theme, 'multi-project-agents', 'Three projects with real Codex, Claude and Pi panes; onboarding only');
      await clip(theme, 'workspace-switching', 'Switching projects preserves each project’s terminal panes', async () => {
        for (const name of ['acme-api', 'docs-site', 'northstar-app']) { await click(name); await pause(1500); }
      });
      await click('Collapse sidebar'); await shot(theme, 'collapsed-rail', 'Collapsed workspace rail with per-project harness icons'); await click('Expand sidebar');
      await click('Settings'); await page.getByRole('radio', { name: 'Tabs', exact: true }).click(); await page.keyboard.press('Escape');
      await shot(theme, 'tabs-navigation', 'Optional workspace Tabs navigation with multiple agent panes');
      await click('Settings'); await page.getByRole('radio', { name: 'Sidebar', exact: true }).click(); await page.keyboard.press('Escape');
      }
      // Use a simple separate workspace for a readable Browser/dev-service composition.
      projects['preview-studio'] ||= createProject(root, 'preview-studio', html);
      await openWorkspace('preview-studio'); await launch('Terminal');
      await page.locator('.xterm:visible .xterm-helper-textarea').last().focus();
      await page.keyboard.type('clear; printf "Northstar preview studio\\n\\n"; npm run test; printf "\\nWorking copy\\n"; git status --short');
      await page.keyboard.press('Enter'); await pause(1200);
      const runServer = page.locator('.ws-nav-item').filter({ has: button('preview-studio') }).getByRole('button', { name: /^Run Dev Server/ });
      await runServer.waitFor({ timeout: 20000 });
      // Activate with the keyboard: the narrow sidebar resize target overlaps
      // the centre of the rightmost row control at default width.
      await runServer.focus(); await runServer.press('Enter');
      await button('Open Dev Server in Browser').waitFor({ timeout: 30000 });
      await clip(theme, 'dev-server-preview', 'Explicit Run Dev Server and native embedded Browser preview', async () => {
        await button('Open Dev Server in Browser').focus();
        await button('Open Dev Server in Browser').press('Enter'); await pause(2200);
        await shot(theme, 'dev-server-browser', 'Live headless dev service with its own Browser preview');
      });
      await click('Expand Files'); await page.getByText('src', { exact: true }).last().click();
      await page.getByText('projects.ts', { exact: true }).dblclick(); await pause(500);
      await shot(theme, 'editor-browser', 'Editor and native Browser together, with service controls in the sidebar');
      const previewUrl = await page.getByPlaceholder('Enter URL…').inputValue();
      await click('New tab');
      await page.getByPlaceholder('Enter URL…').fill(new URL('/guide', previewUrl).href);
      await page.getByPlaceholder('Enter URL…').press('Enter');
      await page.locator('.browser-pane-title').click(); await pause(1800);
      await shot(theme, 'browser-tabs', 'Native Browser tabs for the local dashboard and project guide');
      await clip(theme, 'browser-annotation', 'Entering and leaving native Browser annotation mode', async () => {
        await click('Enter annotation mode'); await pause(700);
        await app.evaluate(async ({ BrowserWindow }) => {
          const view = BrowserWindow.getAllWindows()[0].contentView.children.find(v => v.webContents && /^http:\/\/127\.0\.0\.1:/.test(v.webContents.getURL()) && v.getVisible());
          if (!view) throw new Error('Native preview view not found');
          const point = await view.webContents.executeJavaScript(`(() => { const r = document.querySelector('button').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
          view.webContents.sendInputEvent({ type: 'mouseMove', ...point });
          view.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
          view.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
        });
        await pause(600);
        await app.evaluate(({ BrowserWindow }) => {
          const view = BrowserWindow.getAllWindows()[0].contentView.children.find(v => v.webContents && /^http:\/\/127\.0\.0\.1:/.test(v.webContents.getURL()) && v.getVisible());
          if (!view) throw new Error('Native preview view not found');
          view.webContents.insertText('Make this action clearer: use “Browse projects” and keep a visible keyboard focus ring.');
        });
        await pause(500);
        await shot(theme, 'browser-annotation', 'Selected native Browser element with annotation note and copy/send controls; no handoff performed');
        await click('Exit annotation mode (Esc)');
      });
    } catch (error) {
      console.error('Capture failed:', error);
      fs.writeFileSync(path.join(root, `${theme}-failure.png`), await page.screenshot().catch(() => Buffer.alloc(0)));
      throw error;
    } finally {
      // Kill real terminals and services via their normal IPC lifecycle before closing.
      await page?.evaluate(async () => {
        for (const id of window.captureTerminalIds || []) await window.electronAPI.killTerminal(id);
      }).catch(() => {});
      await stopOwnedCodexDaemons(root);
      const closing = app.close();
      await page?.getByRole('button', { name: /Close Anyway|Close App|Quit Anyway|Close and quit/i }).first().click({ timeout: 2000 }).catch(() => {});
      await closing; app = null;
    }
  }
  index();
})().catch(error => { console.error(error); index(error); process.exitCode = 1; }).finally(() => {
  if (process.env.CAPTURE_KEEP_FIXTURE === '1') console.log('Fixture retained:', root);
  else fs.rmSync(root, { recursive: true, force: true });
  console.log('Assets:', out);
});
