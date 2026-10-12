/* global window, document, MutationObserver */
// Visitor for checkout-presentation-smoke.cjs --native-pi --existing-workspace <root>.
// Installed native Pi, real app selection and existing Git-listed test1. No prompts or Git mutations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
module.exports = async ({ app, page, repo, project, a, mainId, piId, piRow, ocRow, snapshots, explain, mainState, focus, until, pause, nativeVersion }) => {
  const entry = path.join(repo, 'dist/main/main/main.js');
  const facts = id => app.evaluate((_electron, { entry, id }) => {
    const native = process.getBuiltinModule('module').createRequire(entry)(entry);
    const terminal = native.terminals.get(id);
    const context = terminal && native.workspaceRegistry.resolveCheckoutContext(terminal.workspaceId, terminal.checkoutContextId);
    return { terminalId: id, workspaceId: terminal?.workspaceId, launchContextId: terminal?.checkoutContextId, launchDirectory: terminal?.cwd,
      context: context && { id: context.id, path: context.path, environmentId: context.environmentId, kind: context.kind, branch: context.branch } };
  }, { entry, id });
  const status = checkout => app.evaluate(async (_electron, { entry, checkout }) => {
    const native = process.getBuiltinModule('module').createRequire(entry)(entry);
    return native.gitService.getStatus(checkout);
  }, { entry, checkout }); // Read-only one-shot verification, not another poller or status store.
  const mainStatus = await status(project), piStatus = await status(a);
  assert(mainStatus.success && piStatus.success);
  const count = value => new Set(value.changes.map(change => change.path)).size;
  const decorations = (checkout, value) => fs.readdirSync(checkout).filter(name => value.changes.some(change => change.path === name || change.path.startsWith(name + '/'))).length;
  const selectPi = id => focus(piRow, id, a, count(piStatus), 'test1', 'observed', decorations(a, piStatus));
  const selectMain = () => focus(ocRow, mainId, project, count(mainStatus), mainStatus.currentBranch, 'observed', decorations(project, mainStatus));
  const firstFacts = await facts(piId);
  assert.equal(firstFacts.launchDirectory, a); assert.equal(firstFacts.context.path, a);
  assert.equal(firstFacts.context.environmentId, 'local'); assert.equal(firstFacts.context.kind, 'worktree');
  const first = await selectPi(piId);
  assert.equal(first.selection.contextId, firstFacts.launchContextId);
  assert.equal(first.selectedLocationProvenance, 'current');
  await selectMain(); assert.equal(await piRow.locator('.ws-agent-branch').textContent(), 'test1');
  assert((await explain(piId)).renderer.terminalPanePresented, 'Native Pi must remain visible when main is selected');
  const beforeSwitch = await selectPi(piId);
  assert((await explain(mainId)).renderer.terminalPanePresented, 'Main must remain visible when Pi is selected');
  await page.evaluate(id => {
    window.__nativePiStates = []; window.__nativePiUnavailable = false;
    window.electronAPI.onAgentAttentionChanged(change => {
      if (change.terminalId === id) window.__nativePiStates.push(change.snapshot && { state: change.snapshot.locationProvenance?.state, checkoutContextId: change.snapshot.location?.checkoutContextId });
    });
    window.__nativePiObserver = new MutationObserver(() => { if (document.querySelector('.status-checkout-unavailable')) window.__nativePiUnavailable = true; });
    window.__nativePiObserver.observe(document.body, { subtree: true, childList: true, characterData: true });
  }, piId);
  const oldSession = (await snapshots()).find(value => value.terminalId === piId).sessionId;
  // Native TUI /new: session replacement only; all session files live in disposable --session-dir.
  await page.evaluate(id => window.electronAPI.writeTerminal(id, '\x15/new\r'), piId);
  await until(async () => { const value = (await snapshots()).find(value => value.terminalId === piId); return value?.sessionId && value.sessionId !== oldSession && value.locationProvenance?.state === 'current'; }, 'Native Pi /new did not rebind its root');
  const afterSwitch = await selectPi(piId);
  assert.equal(afterSwitch.git.generation, beforeSwitch.git.generation, 'Same-checkout session boundary restarted the Git controller');
  const boundary = await page.evaluate(() => { window.__nativePiObserver.disconnect(); return { states: window.__nativePiStates, unavailableRendered: window.__nativePiUnavailable }; });
  assert(boundary.states.some(value => value?.state === 'last-reported' && value.checkoutContextId === firstFacts.launchContextId), 'Native shutdown must retain historical evidence');
  assert(boundary.states.some(value => value?.state === 'current' && value.checkoutContextId === firstFacts.launchContextId));
  assert.equal(boundary.unavailableRendered, false, 'Agreeing native session boundary made checkout unavailable');
  const verifySourceControl = async (checkout, value) => {
    await page.getByRole('button', { name: 'Source Control', exact: true }).click();
    const identity = page.getByRole('dialog', { name: 'Source Control', exact: true }).locator('.source-control-change-identity');
    await until(async () => (await identity.textContent())?.includes(`${count(value)} changed file`), 'Source Control retained another checkout count');
    assert((await identity.textContent()).includes(checkout), 'Source Control retained another checkout root');
    assert.equal(await identity.locator('strong').textContent(), value.currentBranch);
    await page.keyboard.press('Escape');
  };
  await verifySourceControl(a, piStatus);
  assert.equal((await mainState(piId)).launch, firstFacts.launchContextId);
  // Close the PTY, not the checkout. A returning shell still legitimately occupies its launch root.
  await page.locator('.terminal-pane.active').getByRole('button', { name: 'Close terminal', exact: true }).click();
  await until(async () => !(await snapshots()).some(value => value.terminalId === piId) && !(await facts(piId)).launchContextId, 'Native Pi terminal/evidence did not retire');
  await selectMain(); await verifySourceControl(project, mainStatus);
  await page.getByRole('button', { name: 'New Session', exact: true }).click();
  await page.getByRole('radio', { name: 'Pi', exact: true }).click();
  const available = page.getByRole('group', { name: 'Existing worktrees', exact: true }).getByRole('button', { name: /^test1 / });
  assert.match(await available.textContent(), /Available/, 'Retired native evidence left phantom checkout occupancy');
  await available.click(); await page.getByRole('button', { name: 'Launch Pi', exact: true }).click();
  await until(async () => (await snapshots()).some(value => value.terminalId !== piId && value.location?.path === a && value.locationProvenance?.state === 'current'), 'Managed native Pi relaunch failed');
  await pause(700);
  const secondId = (await snapshots()).find(value => value.location?.path === a).terminalId;
  const secondFacts = await facts(secondId);
  assert.equal(secondFacts.launchContextId, firstFacts.launchContextId, 'Managed relaunch changed or duplicated the registered checkout');
  const second = await selectPi(secondId); await selectMain(); await selectPi(secondId);
  console.log(JSON.stringify({ realElectron: true, nativePi: nativeVersion, scope: 'isolated app profile; existing user Git checkout read-only', actual: secondFacts,
    selection: { ...second.selection, selectedTerminalId: second.workspaceActiveTerminalId }, git: second.git,
    mainDirtyCount: count(mainStatus), test1DirtyCount: count(piStatus), nativeStartupBeforePrompt: 'current; authenticated registered observation',
    nativeSessionBoundary: boundary, sameCheckoutGitGeneration: 'unchanged', sidebarMainTest1Main: 'passed; both panes visible',
    managedRelaunch: 'same context; no phantom occupancy after terminal close', sourceControlExplorerStatus: 'matching branch/root/count/decorations', modelRequests: 0 }));
};
