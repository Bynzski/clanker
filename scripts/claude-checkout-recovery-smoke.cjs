/* global window */
// Linux installed Claude through New Agent's normal PTY/hooks/IPC and built renderer.
// Isolated HOME/profile/Git repos; loopback model responses, no paid inference.
// Print-mode input uses a fixture-only pipe, not interactive-TUI or AppImage proof.
const { _electron: electron } = require('playwright');
const { createSmokeOwner, cleanupSmokeFixture } = require('./lib/smoke-fixture-cleanup.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-claude-checkout-electron-'));
const owner = createSmokeOwner();
for (const name of ['home', 'config', 'cache', 'data', 'profile', 'project', 'other', 'scratch']) fs.mkdirSync(path.join(root, name));
const project = path.join(root, 'project');
const other = path.join(root, 'other');
const scratch = path.join(root, 'scratch');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  ['PATH', 'DISPLAY', 'XAUTHORITY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG', 'LC_ALL'].includes(key)));
Object.assign(env, { [owner.key]: owner.value, NODE_ENV: 'production', ELECTRON_RUN_AS_NODE: '',
  HOME: path.join(root, 'home'), XDG_CONFIG_HOME: path.join(root, 'config'), XDG_CACHE_HOME: path.join(root, 'cache'),
  XDG_DATA_HOME: path.join(root, 'data'), SHELL: '/bin/bash', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  CLAUDE_CONFIG_DIR: path.join(root, 'claude'), ANTHROPIC_API_KEY: 'fixture', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  CLANKER_DEBUG_ATTENTION: '1' });
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, stdio: 'pipe' });
for (const cwd of [project, other]) {
  git(cwd, 'init', '-b', 'main'); git(cwd, 'config', 'user.name', 'Fixture'); git(cwd, 'config', 'user.email', 'fixture@example.invalid');
  fs.writeFileSync(path.join(cwd, 'fixture.txt'), 'committed fixture\n');
  git(cwd, 'add', '.'); git(cwd, 'commit', '-m', 'fixture');
}
// Print-mode Claude rejects TTY stdin before the first prompt. A fixture-only
// transparent pipe keeps stdin non-TTY; hooks/argv/PTY launch remain real.
const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
const realClaude = execFileSync('which', ['claude'], { encoding: 'utf8' }).trim();
fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/bash\ncat | '${realClaude.replaceAll("'", "'\\''")}' "$@"\n`, { mode: 0o700 });
env.PATH = `${bin}:${env.PATH}`;
const flags = '--print --input-format stream-json --output-format stream-json --verbose --allowedTools Bash --model claude-haiku-4-5 --setting-sources project';
fs.writeFileSync(path.join(root, 'profile/config.json'), JSON.stringify({ workspaceNavigationMode: 'tabs',
  harnessDefaults: Object.fromEntries(['codex', 'claude', 'pi', 'opencode', 'omp', 'hermes', 'agy'].map(id => [id,
    { model: '', favorites: [], flags: id === 'claude' ? flags : '', visible: id === 'claude', usageVisible: false, attentionEnabled: id === 'claude' }])) }));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  const deadline = Date.now() + 30000;
  while (!await check()) { if (Date.now() > deadline) throw new Error(label); await pause(50); }
}
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const stream = (index, command) => {
  const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const tool = command !== undefined;
  return event('message_start', { message: { id: `fixture_${index}`, type: 'message', role: 'assistant', content: [],
    model: 'claude-haiku-4-5', usage: { input_tokens: 1, output_tokens: 0 } } })
    + event('content_block_start', { index: 0, content_block: tool ? { type: 'tool_use', id: `bash_${index}`, name: 'Bash', input: {} } : { type: 'text', text: '' } })
    + event('content_block_delta', { index: 0, delta: tool
      ? { type: 'input_json_delta', partial_json: JSON.stringify({ command, description: 'Inspect disposable checkout fixture' }) }
      : { type: 'text_delta', text: 'ok' } })
    + event('content_block_stop', { index: 0 })
    + event('message_delta', { delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } })
    + event('message_stop', {});
};
let command, held, requests = 0, toolError = false;
const model = http.createServer((request, response) => {
  let body = '';
  request.on('data', chunk => { body += chunk; if (body.length > 1024 * 1024) request.destroy(); });
  request.on('end', () => {
    if (request.url.includes('count_tokens')) { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"input_tokens":1}'); return; }
    const index = requests++;
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (command !== undefined) { const next = command; command = undefined; response.end(stream(index, next)); return; }
    try {
      const input = JSON.parse(body);
      const results = input.messages?.at(-1)?.content;
      toolError = !Array.isArray(results) || !results.some(block => block.type === 'tool_result') || results.some(block => block.is_error);
    } catch { toolError = true; }
    held = () => { held = undefined; response.end(stream(index)); };
    response.flushHeaders();
  });
});
let app, page, stage = 'startup', passed = false;
async function run() {
  try {
    const version = execFileSync('claude', ['--version'], { env, encoding: 'utf8', timeout: 5000 }).trim();
    assert.match(version, /^\d+\.\d+\.\d+ \(Claude Code\)$/);
    await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
    env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${model.address().port}`;
    const launch = () => electron.launch({ executablePath: path.join(repo, 'node_modules/electron/dist/electron'),
      args: [repo, `--user-data-dir=${path.join(root, 'profile')}`, '--ozone-platform=headless'], env });
    app = await launch();
    page = await app.firstWindow(); page.setDefaultTimeout(15000);
    await page.evaluate(() => {
      window.__claudeFixtureOutput = {};
      window.electronAPI.onTerminalData(({ id, data }) => {
        window.__claudeFixtureOutput[id] = ((window.__claudeFixtureOutput[id] ?? '') + data).slice(-65536);
      });
    });
    const open = async cwd => {
      await page.getByRole('button', { name: 'Open Workspace', exact: true }).first().click();
      await page.getByRole('textbox', { name: 'Local Directory Path' }).fill(cwd);
      await page.getByRole('dialog').getByText('Where are we working today?').click();
      await page.getByRole('dialog').getByRole('button', { name: /^Open(?: Workspace)?$/ }).click();
    };
    await open(project);
    await page.getByRole('button', { name: 'New Agent', exact: true }).click();
    await page.getByRole('radio', { name: 'Claude', exact: true }).click();
    await page.getByRole('button', { name: 'Launch Claude', exact: true }).click();
    const snapshots = () => page.evaluate(() => window.electronAPI.getAgentAttentionSnapshots());
    // Print-mode Claude starts its native session when the first prompt arrives.
    // The normal launch grant remains independently available before that report.
    await until(async () => (await snapshots()).length === 1, 'Claude attention attachment missing');
    const id = (await snapshots())[0].terminalId;
    await pause(1000);
    await page.locator('.terminal-pane .terminal-content').first().click();
    const snapshot = async () => (await snapshots()).find(snapshot => snapshot.terminalId === id);
    const explain = () => page.evaluate(id => window.clankerAttention.explain(id), id);
    const mainState = () => app.evaluate((_electron, { entry, id }) => {
      const native = process.getBuiltinModule('module').createRequire(entry)(entry);
      const terminal = native.terminals.get(id);
      return { launch: terminal?.checkoutContextId, root: terminal?.cwd,
        contexts: native.workspaceRegistry.getCheckoutContextsForWorkspace(terminal.workspaceId),
        poll: native.gitService.getCurrentWorkspaceIdentity() };
    }, { entry: path.join(repo, 'dist/main/main/main.js'), id });
    const original = await mainState();
    const available = async expected => {
      await until(async () => { const view = (await explain()).renderer.checkoutPresentation;
        return view.selection.availability === 'available' && view.selection.root === expected && view.git.availability === 'ready';
      }, 'Authorized checkout/Git did not recover');
      assert.equal(await page.locator('.status-checkout-unavailable').count(), 0);
      assert.equal((await mainState()).poll.workspacePath, expected);
      assert.equal((await mainState()).launch, original.launch);
    };
    const begin = async (label, text) => {
      stage = label; command = text; toolError = false;
      await page.evaluate(({ id }) => window.electronAPI.writeTerminal(id,
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Run the fixture command and reply ok.' } }) + '\r'), { id });
      await until(() => Boolean(held), 'Native Bash result did not reach loopback continuation');
      assert.equal(toolError, false, 'Native Bash command failed');
    };
    const finish = async () => {
      held();
      await until(async () => (await snapshot())?.runtime.status === 'provisional', 'Native root Stop missing');
      assert.equal((await snapshot()).location?.path, project, 'Root Stop left the tool directory selected');
      assert.equal((await snapshot()).location?.checkoutContextId, original.launch);
      assert.equal((await snapshot()).locationProvenance?.state, 'current');
      assert.equal((await snapshot()).lastCompletion, null, 'Stop must remain provisional');
      await available(project);
    };
    await available(project);
    if (!await page.locator('.file-explorer').count()) await page.getByRole('button', { name: 'Toggle File Explorer', exact: true }).click();
    const expandFiles = page.getByRole('button', { name: 'Expand Files', exact: true });
    if (await expandFiles.count()) await expandFiles.click();
    await until(() => page.locator('.file-explorer').getByText('fixture.txt', { exact: true }).count(), 'Initial main Explorer file missing');
    await begin('main Git inventory', 'git worktree list && git branch --list && pwd');
    await finish();
    await begin('outside Bash excursion', `cd ${quote(scratch)} && pwd`);
    await until(async () => (await snapshot()).location?.path === scratch, 'Outside native CwdChanged not observed');
    assert.equal((await snapshot()).location?.checkoutContextId, null);
    await until(async () => (await explain()).renderer.checkoutPresentation.selection.availability === 'unavailable', 'Unregistered scratch path gained file authority');
    assert.equal((await mainState()).contexts.length, 1);
    await open(other);
    await page.locator('.workspace-tab').filter({ hasText: 'project' }).first().click();
    await until(async () => (await explain()).renderer.checkoutPresentation.workspaceActiveTerminalId === id, 'Workspace return lost active native agent');
    assert.equal((await explain()).renderer.checkoutPresentation.selection.availability, 'unavailable');
    await finish();
    await begin('return to main Git inventory', `cd ${quote(project)} && git worktree list && git branch --list && pwd`);
    await finish();
    await until(() => page.locator('.file-explorer').getByText('fixture.txt', { exact: true }).count(), 'Recovered Explorer file missing');
    stage = 'refocus after recovery';
    await page.locator('.terminal-pane .terminal-content').first().click();
    await available(project);
    stage = 'restart after recovery';
    await cleanupSmokeFixture({ app, repo, owner, workspaceRoots: [project, other] });
    app = await launch();
    page = await app.firstWindow(); page.setDefaultTimeout(15000);
    await until(() => page.locator('.workspace-tab').filter({ hasText: 'project' }).count(), 'Saved project workspace missing after restart');
    await page.locator('.workspace-tab').filter({ hasText: 'project' }).first().click();
    await until(async () => {
      const poll = await app.evaluate((_electron, entry) => process.getBuiltinModule('module').createRequire(entry)(entry).gitService.getCurrentWorkspaceIdentity(), path.join(repo, 'dist/main/main/main.js'));
      return poll?.workspacePath === project && await page.locator('.status-branch').textContent() === 'main';
    }, 'Restart did not restore authorized main selection/Git');
    assert.equal(await page.locator('.status-checkout-unavailable').count(), 0);
    stage = 'complete';
    console.log(JSON.stringify({ realElectron: true, nativeClaude: version, mode: 'stream-json through normal Clanker PTY',
      model: 'loopback fixture (no inference)', mainGitInventory: 'passed', outsideBash: 'unavailable without a new grant',
      workspaceSwitch: 'unavailable observation retained', rootStop: 'main authority/Git recovered; provisional, no completion',
      launchIdentity: 'unchanged', explorer: 'fixture.txt visible before/after recovery', refocus: 'passed', restart: 'saved project main selection/Git ready (not live conversation resume)', requests }));
    passed = true;
  } catch (error) {
    console.error(JSON.stringify({ stage, requests, toolError }));
    console.error(error.stack);
    if (page && !page.isClosed()) fs.writeFileSync(path.join(root, 'private-output.json'), JSON.stringify(await page.evaluate(() => window.__claudeFixtureOutput ?? {})), { mode: 0o600 });
    throw error;
  } finally {
    await cleanupSmokeFixture({ app, repo, owner, workspaceRoots: [project, other], servers: [model] });
    if (passed) fs.rmSync(root, { recursive: true, force: true });
    else console.error(`Private failed fixture retained: ${root}`);
  }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
