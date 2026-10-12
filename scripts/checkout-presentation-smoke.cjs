/* global window, document */
// Built Electron + real Git/PTY/IPC/React; authenticated explicit location fixture, NOT a native harness cwd move.
// Default: disposable HOME/profile/repository. Optional --native-pi --existing-workspace is guarded read-only;
// no inherited credentials, inference, user configuration or SSH operations.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-checkout-presentation-'));
for (const name of ['home', 'config', 'cache', 'data', 'profile', 'bin', 'worktree-tests', 'unknown']) fs.mkdirSync(path.join(root, name));
const existingIndex = process.argv.indexOf('--existing-workspace');
const nativePi = process.argv.includes('--native-pi');
if (nativePi !== (existingIndex >= 0)) throw new Error('Use --native-pi and --existing-workspace together');
const project = nativePi ? fs.realpathSync(process.argv[existingIndex + 1]) : path.join(root, 'worktree-tests');
let a = path.join(root, 'test1'); const b = path.join(root, 'test2');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG', 'LC_ALL'].includes(key)));
Object.assign(env, { PATH: `${path.join(root, 'bin')}:${env.PATH}`, NODE_ENV: 'production', CLANKER_DEBUG_ATTENTION: '1', ELECTRON_RUN_AS_NODE: '', HOME: path.join(root, 'home'), XDG_CONFIG_HOME: path.join(root, 'config'), XDG_CACHE_HOME: path.join(root, 'cache'), XDG_DATA_HOME: path.join(root, 'data'), SHELL: '/bin/bash', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0' });
const git = (cwd, ...args) => {
  if (nativePi && !['status', 'ls-files'].includes(args[0]) && !(args[0] === 'worktree' && args[1] === 'list')) throw new Error('Existing-workspace smoke forbids Git mutations');
  return execFileSync('git', args, { cwd, env, stdio: 'pipe' });
};
if (nativePi) {
  const listed = git(project, 'worktree', 'list', '--porcelain').toString().split('\n\n');
  const entry = listed.find(row => /^branch refs\/heads\/test1$/m.test(row));
  assert(entry && !/^locked|^prunable/m.test(entry), 'Expected an existing usable Git-listed test1');
  a = fs.realpathSync(entry.split('\n')[0].slice('worktree '.length));
  assert.notEqual(a, project, 'test1 must be a linked checkout');
} else {
  git(project, 'init', '-b', 'main'); git(project, 'config', 'user.name', 'Fixture'); git(project, 'config', 'user.email', 'fixture@example.invalid');
  for (const name of ['same.ts', 'other.ts']) fs.writeFileSync(path.join(project, name), `export const fixture = '${name}';\n`);
  git(project, 'add', '.'); git(project, 'commit', '-m', 'fixture'); git(project, 'worktree', 'add', '-b', 'test1', a); git(project, 'worktree', 'add', '-b', 'test2', b);
}
// Compare existing tracked/unignored files and Git metadata; read symlink targets, never follow them.
const preservation = () => [git(project, 'worktree', 'list', '--porcelain').toString(), ...[project, a].map(checkout => {
  const hash = require('node:crypto').createHash('sha256');
  hash.update(git(checkout, 'status', '--porcelain=v1', '-z'));
  for (const name of [...new Set(git(checkout, 'ls-files', '--cached', '--others', '--exclude-standard', '-z').toString().split('\0').filter(Boolean))].sort()) {
    const file = path.join(checkout, name); hash.update(name);
    let stat;
    try { stat = fs.lstatSync(file); }
    catch (error) { if (error.code !== 'ENOENT') throw error; hash.update('missing'); continue; }
    hash.update(String(stat.mode));
    if (stat.isSymbolicLink()) hash.update(fs.readlinkSync(file)); else if (stat.isFile()) hash.update(fs.readFileSync(file));
  }
  return hash.digest('hex');
})];
const preserved = nativePi ? preservation() : null;
fs.writeFileSync(path.join(root, 'bin/pi'), `#!${process.execPath}
if(process.argv.includes('--version')) { console.log('1.1.0'); process.exit(0); }
(async()=>{
 const {emit}=await import(require('node:url').pathToFileURL(require('node:path').join(require('node:path').dirname(process.env.CLANKER_ATTENTION_COMMAND),'observer.mjs')).href);
 let sessionId='fixture-'+process.pid; const cwd=process.cwd(); let ended=require('node:path').basename(cwd)==='test1';
 if(!ended) await emit('session_started',{scope:'root',sessionId,cwd,nativeEvent:'checkout_fixture'});
 console.log('fixture-ready');
 let queue=Promise.resolve(); require('node:readline').createInterface({input:process.stdin}).on('line',line=>{queue=queue.then(async()=>{
  if(line==='exit') {await emit('agent_exited',{scope:'root',sessionId,nativeEvent:'checkout_fixture'});process.exit(0);}
  if(line==='end') {await emit('session_ended',{scope:'root',sessionId,nativeEvent:'checkout_fixture'});sessionId+='-next';ended=true;}
  if(line.startsWith('loc ')) {await emit(ended?'session_started':'location_changed',{scope:'root',sessionId,cwd:line.slice(4),nativeEvent:'checkout_fixture'});ended=false;}
 })});
})();
`, { mode: 0o700 });
fs.copyFileSync(path.join(root, 'bin/pi'), path.join(root, 'bin/opencode'));
if (nativePi) fs.unlinkSync(path.join(root, 'bin/pi')); // Resolve installed Pi, not the explicit emitter.
const nativeVersion = nativePi ? execFileSync('pi', ['--version'], { env }).toString().trim() : null;
fs.writeFileSync(path.join(root, 'profile/config.json'), JSON.stringify({ workspaceNavigationMode: 'sidebar', harnessDefaults: Object.fromEntries(['codex', 'claude', 'pi', 'opencode', 'omp', 'hermes', 'agy'].map(id => [id, { model: '', favorites: [], flags: nativePi && id === 'pi' ? `--no-extensions --no-skills --session-dir ${path.join(root, 'sessions')} --provider fixture --model tiny` : '', visible: ['pi', 'opencode'].includes(id), usageVisible: false, attentionEnabled: ['pi', 'opencode'].includes(id) }])) }));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) { const end = Date.now() + 20000; while (!await check()) { if (Date.now() > end) throw new Error(label); await pause(50); } }
let app, server; let modelRequests = 0;
(async () => {
  try {
    if (nativePi) {
      server = require('node:http').createServer((_request, response) => { modelRequests++; response.writeHead(503); response.end(); });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const agent = path.join(root, 'agent'); fs.mkdirSync(agent); env.PI_CODING_AGENT_DIR = agent;
      fs.writeFileSync(path.join(agent, 'settings.json'), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
      fs.writeFileSync(path.join(agent, 'models.json'), JSON.stringify({ providers: { fixture: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'fixture', models: [{ id: 'tiny', name: 'fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 128 }] } } }));
    }
    app = await electron.launch({ executablePath: path.join(repo, 'node_modules/electron/dist/electron'), args: [repo, `--user-data-dir=${path.join(root, 'profile')}`, '--ozone-platform=headless'], env });
    const page = await app.firstWindow(); page.setDefaultTimeout(15000);
    await page.evaluate(() => { window.__ready = new Set(); window.electronAPI.onTerminalData(({ id, data }) => { if (data.includes('fixture-ready')) window.__ready.add(id); }); });
    await page.getByRole('button', { name: 'Open Workspace', exact: true }).first().click();
    await page.getByRole('textbox', { name: 'Local Directory Path' }).fill(project);
    await page.getByRole('dialog').getByText('Where are we working today?').click();
    await page.getByRole('dialog').getByRole('button', { name: /^Open(?: Workspace)?$/ }).click();
    await page.getByRole('button', { name: 'New Agent', exact: true }).click();
    await page.getByRole('radio', { name: 'OpenCode', exact: true }).click();
    await page.getByRole('button', { name: 'Launch OpenCode', exact: true }).click();
    const snapshots = () => page.evaluate(() => window.electronAPI.getAgentAttentionSnapshots());
    await until(async () => (await snapshots()).some(value => value.location?.path === project), 'Main fixture did not authenticate a location');
    const mainId = (await snapshots()).find(value => value.location?.path === project).terminalId;
    await until(() => page.evaluate(id => window.__ready.has(id), mainId), 'Main PTY not ready');
    await pause(700); // Let the standard terminal startup/focus handshake finish before opening a popover.
    for (const branch of nativePi ? ['test1'] : ['test1', 'test2']) {
      await page.getByRole('button', { name: 'New Agent', exact: true }).click();
      await page.getByRole('radio', { name: 'Pi', exact: true }).click();
      await page.getByRole('group', { name: 'Existing worktrees', exact: true }).getByRole('button', { name: new RegExp(`^${branch} `) }).click();
      await page.getByRole('button', { name: 'Launch Pi', exact: true }).click();
      await until(async () => (await snapshots()).length === (branch === 'test1' ? 2 : 3), `Checkout ${branch} was not attached/launched`);
      if (nativePi) await until(async () => (await snapshots()).some(value => value.location?.path === a && value.locationProvenance?.state === 'current'), 'Native Pi startup did not publish a current authenticated location');
      else await until(() => page.evaluate(count => window.__ready.size === count, branch === 'test1' ? 2 : 3), 'Isolated PTY not ready');
      await pause(700);
    }
    if (!nativePi) await until(() => page.evaluate(() => window.__ready.size === 3), 'Three fixture PTYs were not ready');
    await page.locator('.terminal-pane .terminal-content').first().click();
    const expandFiles = page.getByRole('button', { name: 'Expand Files', exact: true });
    if (await expandFiles.count()) await expandFiles.click();
    const send = line => page.evaluate(({ id, line }) => window.electronAPI.writeTerminal(id, line + '\n'), { id: mainId, line });
    const view = () => page.evaluate(() => ({ root: document.querySelector('.status-project')?.title, badge: document.querySelector('.git-badge')?.textContent ?? '0', changed: document.querySelectorAll('.file-explorer .git-status-indicator').length, staged: document.querySelectorAll('.file-explorer .git-staged').length, untracked: document.querySelectorAll('.file-explorer .git-untracked').length }));
    // Query actual main state and the existing gated renderer diagnostics, not terminal text.
    const mainState = id => app.evaluate((_electron, { entry, id }) => {
      const native = process.getBuiltinModule('module').createRequire(entry)(entry);
      return { launch: native.terminals.get(id)?.checkoutContextId, poll: native.gitService.getCurrentWorkspaceIdentity(), generation: native.gitService.getPresentationGeneration() };
    }, { entry: path.join(repo, 'dist/main/main/main.js'), id });
    await until(() => page.evaluate(() => Boolean(window.clankerAttention)), 'Debug query view not enabled');
    const piRow = page.locator('.ws-agent-row').filter({ hasText: 'test1' });
    const ocRow = page.locator('.ws-agent-row').filter({ hasText: 'OpenCode' });
    const piId = await app.evaluate((_electron, { entry, checkout }) => {
      const native = process.getBuiltinModule('module').createRequire(entry)(entry);
      return [...native.terminals].find(([, terminal]) => terminal.cwd === checkout)?.[0];
    }, { entry: path.join(repo, 'dist/main/main/main.js'), checkout: a });
    assert(piId, 'Pi launch context not present in main');
    const explain = id => page.evaluate(id => window.clankerAttention.explain(id), id);
    if (!nativePi) {
      fs.appendFileSync(path.join(project, 'same.ts'), '// main change\n');
      fs.appendFileSync(path.join(a, 'same.ts'), '// test1 change\n'); fs.writeFileSync(path.join(a, 'new.ts'), '// untracked\n');
    }
    const focus = async (row, id, checkout, count, branch, source, decorationCount = count) => {
      await row.click();
      await until(async () => { const data = (await explain(id)).renderer.checkoutPresentation; return data.workspaceActiveTerminalId === id && data.globalActiveTerminalId === id && data.selection.root === checkout && data.git.availability === 'ready'; }, 'Sidebar selection/snapshot not aligned');
      const data = (await explain(id)).renderer.checkoutPresentation;
      assert.equal(data.selection.source, source); assert(data.git.matchesSelection);
      const native = await mainState(id);
      assert.equal(native.poll.workspacePath, checkout); assert.equal(native.generation, data.git.generation);
      assert.equal(native.poll.checkoutContextId ?? `${native.poll.workspaceId}::main`, data.selection.contextId);
      await until(async () => { const value = await view(); return value.root === checkout && value.badge === (count > 99 ? '99+' : String(count)) && value.changed === decorationCount; }, 'Two-agent counts/decorations did not align');
      assert.equal(await page.locator('.status-branch').textContent(), branch);
      assert.equal(await page.locator('.status-checkout-unavailable').count(), 0);
      return data;
    };
    if (nativePi) {
      await require('./pi-checkout-startup-smoke.cjs')({ app, page, repo, project, a, mainId, piId, piRow, ocRow, snapshots, explain, mainState, focus, until, pause, nativeVersion });
      assert.equal(modelRequests, 0, 'Native startup/session switching must not request inference');
      return;
    }
    const launched = await focus(piRow, piId, a, 2, 'test1', 'launch');
    assert.equal((await snapshots()).find(value => value.terminalId === piId).location, null);
    await page.evaluate(({ id, cwd }) => window.electronAPI.writeTerminal(id, `loc ${cwd}\n`), { id: piId, cwd: a });
    await until(async () => (await snapshots()).find(value => value.terminalId === piId).locationProvenance?.state === 'current', 'Pi current fixture report missing');
    const observed = (await explain(piId)).renderer.checkoutPresentation;
    assert.equal(observed.selection.source, 'observed'); assert.equal(observed.git.generation, launched.git.generation);
    await page.evaluate(id => window.electronAPI.writeTerminal(id, 'end\n'), piId);
    await until(async () => (await snapshots()).find(value => value.terminalId === piId).locationProvenance?.state === 'last-reported', 'Historical Pi fixture report missing');
    const historical = await focus(piRow, piId, a, 2, 'test1', 'launch');
    assert(historical.selection.historicalLaunchFallback); assert.equal(historical.git.generation, launched.git.generation);
    await page.locator('.status-selection-notice').getByText('Launch checkout · agent location last-reported', { exact: true }).waitFor();
    await page.evaluate(({ id, cwd }) => window.electronAPI.writeTerminal(id, `loc ${cwd}\n`), { id: piId, cwd: a });
    await until(async () => (await snapshots()).find(value => value.terminalId === piId).locationProvenance?.state === 'current', 'Same-root new session did not publish current evidence');
    assert.equal((await explain(piId)).renderer.checkoutPresentation.git.generation, launched.git.generation);
    await focus(ocRow, mainId, project, 1, 'main', 'observed');
    assert.equal(await piRow.locator('.ws-agent-branch').textContent(), 'test1');
    assert((await explain(piId)).renderer.terminalPanePresented, 'Pi pane must remain visible while OpenCode is selected');
    await focus(piRow, piId, a, 2, 'test1', 'observed');
    assert((await explain(mainId)).renderer.terminalPanePresented, 'OpenCode pane must remain visible while Pi is selected');
    assert.equal((await mainState(piId)).launch, launched.selection.contextId);
    await ocRow.click();
    for (const matrix of [[3, 0, 0], [0, 2, 0], [3, 2, 0], [1, 2, 3]]) {
      for (const [index, checkout] of [project, a, b].entries()) {
        git(checkout, 'reset', '--hard', 'HEAD'); git(checkout, 'clean', '-fd');
        if (matrix[index] >= 1) { fs.appendFileSync(path.join(checkout, 'same.ts'), '// staged\n'); git(checkout, 'add', 'same.ts'); }
        if (matrix[index] >= 2) fs.appendFileSync(path.join(checkout, 'other.ts'), '// modified\n');
        if (matrix[index] >= 3) fs.writeFileSync(path.join(checkout, 'new.ts'), '// untracked\n');
      }
      for (const [index, checkout] of [project, a, b, project].entries()) {
        await send(`loc ${checkout}`);
        await until(async () => (await view()).root === checkout, 'Status bar did not follow the current authenticated report');
        await page.getByRole('button', { name: 'Source Control', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Source Control', exact: true });
        await dialog.getByRole('button', { name: 'Refresh changes', exact: true }).click();
        await page.keyboard.press('Escape');
        const count = matrix[index === 3 ? 0 : index];
        await until(async () => { const value = await view(); return value.badge === String(count) && value.changed === count; }, 'Header and Explorer dirty counts disagreed');
        const value = await view(); assert.equal(value.staged, count ? 1 : 0); assert.equal(value.untracked, count === 3 ? 1 : 0);
      }
    }
    // Historical evidence is not live selection and does not authorize a main fallback.
    await send(`loc ${a}`); await until(async () => (await view()).root === a, 'A not selected');
    await send('end'); await page.getByText(/last-reported from an earlier session/).waitFor();
    assert.equal((await view()).root, ''); assert.equal((await view()).badge, '0');
    await send(`loc ${path.join(root, 'unknown')}`); await page.getByText(/outside this workspace’s registered checkouts/).waitFor();
    assert.equal((await view()).root, '');
    // #170: explicit main launch works while this focused agent remains unregistered.
    const prior = await mainState(mainId);
    await page.getByRole('button', { name: 'New Agent', exact: true }).click();
    await page.getByRole('radio', { name: 'Terminal', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Main checkout', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'Launch Terminal', exact: true }).click();
    await until(async () => (await view()).root === project, 'Explicit main launch blocked by unregistered observation');
    assert.equal((await mainState(mainId)).launch, prior.launch, 'Old agent launch binding moved');
    await ocRow.click(); await page.getByText(/outside this workspace’s registered checkouts/).waitFor();
    assert.equal((await view()).root, '', 'Old unregistered observation silently gained authority');
    await send('exit'); await until(async () => !(await snapshots()).some(value => value.terminalId === mainId), 'Agent exit did not retire observed evidence');
    await until(async () => (await view()).root === project, 'After agent retirement launch selection did not return');
    console.log(JSON.stringify({ realElectron: true, realGit: true, realPTY: true, locationSource: 'authenticated explicit fixture (not native provider cwd movement)', mainAndTwoWorktrees: 'passed', dirtyMatrices: 4, twoAgentSidebarFocus: 'OpenCode main / Pi test1; launch→current; main/renderer/poll identities and generations verified; both panes visible', selectedMainABMain: 'passed', stagedModifiedUntracked: 'passed', historicalAgreeingLaunch: 'launch selection; historical notice; same generation', historicalDisagreementAndUnregistered: 'unavailable without main fallback', explicitMainLaunchWhileUnregistered: 'passed; old binding and unavailable file authority retained', agentRetirement: 'launch authority retained; observed evidence retired' }));
  } catch (error) {
    console.error(error.message);
    if (app) console.error(JSON.stringify(await (await app.firstWindow()).evaluate(() => ({ popover: document.querySelector('.new-session-popover') !== null, buttons: [...document.querySelectorAll('.new-session-popover button')].map(button => button.textContent), newSessionDisabled: document.querySelector('.new-session-trigger')?.disabled, readyPTYs: window.__ready?.size }))));
    process.exitCode = 1;
  }
  finally {
    await app?.close();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    try {
      if (preserved) {
        assert.deepEqual(preservation(), preserved, 'Existing checkout files/status/worktree list changed');
        assert.equal(modelRequests, 0, 'Native lifecycle made an unexpected model request');
        console.log(JSON.stringify({ existingCheckoutFilesStatusAndGitRegistration: 'unchanged after app cleanup', modelRequests }));
      }
    }
    catch (error) { console.error(error.message); process.exitCode = 1; }
    fs.rmSync(root, { recursive: true, force: true });
  }
})();
