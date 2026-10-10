/* global window, document */
// Full built Electron app, real PTYs/IPC/mounted React. Explicit lifecycle fixture, NOT native provider verification.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const repo = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-attention-electron-'));
for (const name of ['home', 'config', 'cache', 'data', 'profile', 'bin', 'A', 'B', 'C', 'D']) fs.mkdirSync(path.join(root, name));
fs.writeFileSync(path.join(root, 'bin/pi'), `#!${process.execPath}
if(process.argv.includes('--version')) {console.log('1.1.0');process.exit(0)}
(async()=>{
 const {emit}=await import(require('node:url').pathToFileURL(require('node:path').join(require('node:path').dirname(process.env.CLANKER_ATTENTION_COMMAND),'observer.mjs')).href);
 let epoch=0,queue=Promise.resolve();const lines=require('node:readline').createInterface({input:process.stdin});
 lines.on('line',line=>{queue=queue.then(async()=>{
  if(line==='exit')process.exit(0);
  const event=line==='start'?'turn_started':line==='stop'?'turn_provisional':line==='done'?'turn_completed':line==='ask'?'input_requested':line==='resolve'?'input_resolved':null;
  if(!event)return;if(line==='start')epoch++;
  await emit(event,{scope:'root',sessionId:'fixture',turnId:String(epoch),inputId:'wait',nativeEvent:'electron_fixture'});
  console.log('fixture-processed');
 })});console.log('fixture-ready');
})();
`, { mode: 0o700 });
fs.writeFileSync(path.join(root, 'profile/config.json'), JSON.stringify({ workspaceNavigationMode: 'tabs',
  harnessDefaults: Object.fromEntries(['codex', 'claude', 'pi', 'opencode', 'omp', 'hermes', 'agy'].map(id => [id, { model: '', favorites: [], flags: '', visible: id === 'pi', usageVisible: false, attentionEnabled: id === 'pi' }])) }));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG', 'LC_ALL'].includes(key)));
Object.assign(env, { PATH: `${path.join(root, 'bin')}:${env.PATH}`, NODE_ENV: 'production', ELECTRON_RUN_AS_NODE: '', CLANKER_DEBUG_ATTENTION: '1',
  HOME: path.join(root, 'home'), XDG_CONFIG_HOME: path.join(root, 'config'), XDG_CACHE_HOME: path.join(root, 'cache'), XDG_DATA_HOME: path.join(root, 'data'), SHELL: '/bin/bash', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) { const end = Date.now() + 15000; while (!await check()) { if (Date.now() > end) throw new Error(label); await pause(50); } }
let app;
(async () => {
  try {
    app = await electron.launch({ executablePath: path.join(repo, 'node_modules/electron/dist/electron'), args: [repo, `--user-data-dir=${path.join(root, 'profile')}`, '--ozone-platform=headless'], env });
    let page = await app.firstWindow(); page.setDefaultTimeout(10000);
    await page.evaluate(() => { window.__fixtureReady = new Set(); window.electronAPI.onTerminalData(({ id, data }) => { if (data.includes('fixture-ready')) window.__fixtureReady.add(id); }); });
    const open = async name => {
      await page.getByRole('button', { name: 'Open Workspace', exact: true }).first().click();
      await page.getByRole('textbox', { name: 'Local Directory Path' }).fill(path.join(root, name));
      await page.getByRole('dialog').getByText('Where are we working today?').click();
      await page.getByRole('dialog').getByRole('button', { name: /^Open(?: Workspace)?$/ }).click();
      await page.getByRole('group', { name: 'New terminal' }).getByRole('button', { name: 'Pi', exact: true }).click();
      let id;
      await until(async () => { id = await page.evaluate(async () => (await window.electronAPI.getAgentAttentionSnapshots()).filter(s => !window.__smokeIds?.includes(s.terminalId)).at(-1)?.terminalId); return Boolean(id); }, 'No native attachment registration');
      await page.evaluate(id => { (window.__smokeIds ??= []).push(id); }, id);
      await until(async () => page.evaluate(id => window.__fixtureReady.has(id), id), 'PTY fixture not ready');
      return id;
    };
    const explain = id => page.evaluate(id => window.clankerAttention.explain(id), id);
    const send = (id, line) => page.evaluate(({ id, line }) => window.electronAPI.writeTerminal(id, line + '\n'), { id, line });
    const state = async (id, status) => until(async () => {
      const view = await explain(id); return view?.main?.status === status && view.renderer.comparison === 'current';
    }, `Attention did not reach ${status}`);
    const a = await open('A'); await send(a, 'start'); await state(a, 'running');
    const b = await open('B'); await send(b, 'start'); await state(b, 'running');
    assert.equal((await explain(a)).renderer.workspaceMember, true);
    await send(a, 'done'); await state(a, 'idle');
    assert.equal((await explain(a)).renderer.indicator, 'turn_complete');
    await send(a, 'start'); await state(a, 'running');
    const c = await open('C'), d = await open('D');
    await until(async () => (await explain(a)).renderer.residency === 'cold', 'Four-workspace cold unmount did not occur');
    assert.equal((await explain(a)).renderer.snapshotPresent, true);
    assert.equal((await explain(a)).renderer.tombstone, false);
    await send(a, 'stop'); await state(a, 'provisional');
    assert.equal((await explain(a)).renderer.indicator, 'provisional');
    assert.equal((await page.evaluate(() => window.electronAPI.getAgentHandoffStatuses()))[a], 'provisional');
    await send(a, 'start'); await state(a, 'running');
    await send(a, 'ask'); await state(a, 'running');
    await until(async () => (await explain(a)).renderer.indicator === 'needs_input', 'Cold background wait not visible in store');
    // Select the actual tab, remount contents and ensure the attention icon is mounted.
    await page.locator('.workspace-tab').filter({ hasText: 'A' }).first().click();
    await until(async () => (await explain(a)).renderer.terminalPanePresented, 'Restored pane not presented');
    await page.getByRole('img', { name: /Needs input/ }).first().waitFor();
    await send(a, 'stop'); await state(a, 'provisional');
    assert.equal((await explain(a)).renderer.indicator, 'provisional');
    await page.getByRole('img', { name: /Stopped · outcome unverified/ }).first().waitFor();
    await send(a, 'start'); await state(a, 'running');
    await page.getByRole('button', { name: 'Minimize pane', exact: true }).first().click();
    await until(async () => !(await explain(a)).renderer.terminalPanePresented, 'Minimized pane still presented');
    await send(a, 'done'); await state(a, 'idle');
    await send(a, 'start'); await state(a, 'running');
    // Restore from the minimized pane shelf, then switch to an empty page.
    await page.getByRole('button', { name: 'Agents in A (has minimized agents)', exact: true }).click();
    await page.locator('.workspace-tab-agents-popover .ws-agent-row').first().click();
    await until(async () => (await explain(a)).renderer.terminalPanePresented, 'Minimized pane did not restore');
    await page.getByRole('button', { name: 'Add page', exact: true }).click();
    await until(async () => !(await explain(a)).renderer.terminalPanePresented, 'Hidden page still presented');
    await send(a, 'done'); await state(a, 'idle'); await send(a, 'start'); await state(a, 'running');
    await page.getByRole('button', { name: 'Page 1', exact: true }).click();
    await until(async () => (await explain(a)).renderer.terminalPanePresented, 'Page return did not restore presentation');
    await page.getByRole('button', { name: 'Close terminal', exact: true }).first().click();
    await until(async () => (await explain(a)).main === null, 'Terminal close did not retire main');
    await send(b, 'exit'); await until(async () => (await explain(b)).main === null && (await explain(b)).renderer.tombstone, 'PTY exit did not retire renderer');
    assert.equal((await explain(c)).renderer.workspaceMember, true); assert.equal((await explain(d)).renderer.workspaceMember, true);
    // Restart with the same owned profile. Workspace persistence survives; old PTY authority must not.
    await send(c, 'start'); await state(c, 'running'); await send(c, 'stop'); await state(c, 'provisional');
    await page.evaluate(async ids => { for (const id of ids) await window.electronAPI.killTerminal(id); }, [c, d]);
    await until(async () => page.evaluate(() => JSON.parse(localStorage.getItem('clanker-grid:open-workspaces:v1')).workspaces.length === 4), 'Workspace set not persisted');
    await app.evaluate(({ session }) => session.defaultSession.flushStorageData());
    await pause(500);
    await app.close();
    app = await electron.launch({ executablePath: path.join(repo, 'node_modules/electron/dist/electron'), args: [repo, `--user-data-dir=${path.join(root, 'profile')}`, '--ozone-platform=headless'], env });
    page = await app.firstWindow(); page.setDefaultTimeout(10000);
    await until(async () => (await page.locator('.workspace-tab').count()) === 4, 'Four workspaces not restored after restart');
    assert.equal((await page.evaluate(() => window.electronAPI.getAgentAttentionSnapshots())).length, 0, 'Restart resurrected old attention authority');
    await page.evaluate(() => { window.__fixtureReady = new Set(); window.electronAPI.onTerminalData(({ id, data }) => { if (data.includes('fixture-ready')) window.__fixtureReady.add(id); }); });
    const restored = await open('A'); await send(restored, 'start'); await state(restored, 'running');
    await send(restored, 'stop'); await state(restored, 'provisional');
    await send(restored, 'start'); await state(restored, 'running'); await send(restored, 'done'); await state(restored, 'idle');
    console.log(JSON.stringify({ realElectron: true, lifecycleSource: 'explicit PTY fixture', simultaneousWorkspaces: 2, coldWorkspaces: 4, activeSwitch: 'passed', backgroundCompletionAndNextTurn: 'passed', minimize: 'passed', hiddenPage: 'passed', restore: 'passed', terminalClose: 'passed', ptyExit: 'passed', rendererRevision: 'current', provisionalStop: 'passed in cold and mounted panes', provisionalApproval: 'passed without actionable alert', restart: 'four restored workspaces, fresh attention registration and subsequent turns passed' }));
  } catch (error) {
    // Safe diagnostics only; never dump terminal output, environment or page contents.
    console.error(error.message);
    if (app) console.error(JSON.stringify(await (await app.firstWindow()).evaluate(() => ({ restoredTabs: document.querySelectorAll('.workspace-tab').length, savedCount: JSON.parse(localStorage.getItem('clanker-grid:open-workspaces:v1') || '{}').workspaces?.length }))));
    if (app) { const page = await app.firstWindow(); console.error(JSON.stringify(await page.evaluate(async () => Promise.all((window.__smokeIds ?? []).map(id => window.clankerAttention?.explain(id)))))); }
    process.exitCode = 1;
  } finally { await app?.close(); fs.rmSync(root, { recursive: true, force: true }); }
})();
