const assert = require('node:assert/strict');
const path = require('node:path');
// Owned disposable fixture only: delay a real log read and reject exactly one
// status command. No successful status/list is fabricated, and no second poller.
module.exports = async ({ app, page, repo, project, git, snapshot, baseline = false }) => {
  const entry = path.join(repo, 'dist/main/main/main.js');
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const metrics = { baseline };
  await app.evaluate((_electron, { entry, project }) => {
    const service = process.getBuiltinModule('module').createRequire(entry)(entry).gitService;
    const original = service.execGit;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const probe = { logStarted: false, released: false, failStatus: false, release, original, timer: setTimeout(release, 8000) };
    service.__sourceResourceProbe = probe;
    service.execGit = async function (cwd, args, ...rest) {
      if (cwd === project && args[0] === 'log' && !probe.released) { probe.logStarted = true; await gate; }
      if (cwd === project && args[0] === 'status' && probe.failStatus) {
        probe.failStatus = false;
        throw new Error('Owned fixture status acquisition fault');
      }
      return original.call(this, cwd, args, ...rest);
    };
  }, { entry, project });
  const release = () => app.evaluate((_electron, entry) => {
    const service = process.getBuiltinModule('module').createRequire(entry)(entry).gitService;
    service.__sourceResourceProbe.released = true;
    service.__sourceResourceProbe.release();
  }, entry);
  try {
    metrics.beforeOpen = await snapshot();
    await page.getByRole('button', { name: 'Source Control', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Source Control', exact: true });
    await dialog.getByRole('button', { name: 'Stage README.md', exact: true }).waitFor();
    await pause(80);
    metrics.openedChanges = await snapshot();
    await dialog.getByRole('navigation').getByRole('button', { name: 'History', exact: true }).click();
    for (let i = 0; i < 100; i++) {
      if (await app.evaluate((_electron, entry) => process.getBuiltinModule('module').createRequire(entry)(entry).gitService.__sourceResourceProbe.logStarted, entry)) break;
      await pause(10);
      if (i === 99) throw new Error('Owned real history read did not reach gate');
    }
    const start = Date.now();
    await dialog.getByRole('navigation').getByRole('button', { name: 'Branches', exact: true }).click();
    const row = dialog.getByRole('button', { name: 'Switch to branch cancel-delete', exact: true });
    for (let i = 0; i < 30 && !(await row.count() && await row.isEnabled()); i++) await pause(10);
    metrics.branchesWhileHistoryHeld = { ready: Boolean(await row.count() && await row.isEnabled()), elapsedMs: Date.now() - start, ...(await snapshot()) };
    if (!baseline) assert(metrics.branchesWhileHistoryHeld.ready, 'Branches coupled to held History');
    await release();
    await row.waitFor();
    await dialog.getByRole('navigation').getByRole('button', { name: 'Changes', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Commit Message' }).fill('owned probe intent');
    metrics.beforeFaultedStage = await snapshot();
    await app.evaluate((_electron, entry) => { process.getBuiltinModule('module').createRequire(entry)(entry).gitService.__sourceResourceProbe.failStatus = true; }, entry);
    await dialog.getByRole('button', { name: 'Stage All', exact: true }).click();
    if (baseline) await dialog.getByRole('button', { name: 'Unstage README.md', exact: true }).waitFor();
    else await dialog.getByText(/Stage succeeded, but status could not be refreshed/).waitFor();
    const warning = await dialog.getByText(/Stage succeeded, but status could not be refreshed/).count();
    metrics.faultedStage = { warning: Boolean(warning), commitDisabled: await dialog.getByRole('button', { name: 'Commit Staged', exact: true }).isDisabled(), ...(await snapshot()) };
    assert(git('diff', '--cached').toString().includes('uncommitted'), 'Stage did not actually succeed');
    if (!baseline) {
      assert(warning && metrics.faultedStage.commitDisabled, 'Failed acquisition enabled mutations or hid outcome');
      assert.equal((metrics.faultedStage.counts.stage || 0) - (metrics.beforeFaultedStage.counts.stage || 0), 1);
      assert.equal((metrics.faultedStage.counts.getStatus || 0) - (metrics.beforeFaultedStage.counts.getStatus || 0), 1);
    }
    await dialog.getByRole('button', { name: 'Refresh changes', exact: true }).click();
    await dialog.getByRole('button', { name: 'Unstage README.md', exact: true }).waitFor();
    metrics.recovered = await snapshot();
    await dialog.getByRole('textbox', { name: 'Commit Message' }).fill('');
    git('reset', 'HEAD', '--', 'README.md');
    await dialog.getByRole('button', { name: 'Refresh changes', exact: true }).click();
    await dialog.getByRole('button', { name: 'Stage README.md', exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Close Source Control' }).click();
    return metrics;
  } finally {
    await release();
    await app.evaluate((_electron, entry) => {
      const service = process.getBuiltinModule('module').createRequire(entry)(entry).gitService;
      const probe = service.__sourceResourceProbe;
      clearTimeout(probe.timer); service.execGit = probe.original; delete service.__sourceResourceProbe;
    }, entry);
  }
};
