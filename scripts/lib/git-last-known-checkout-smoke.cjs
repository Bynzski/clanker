// Read-only fixture gate: holds the next real selected-checkout acquisition, never fabricates status.
const assert = require('node:assert/strict');
const path = require('node:path');
module.exports = async function ({ app, page, repo, checkout, row, id, explain, mainState, oldGeneration, until }) {
  const entry = path.join(repo, 'dist/main/main/main.js');
  await app.evaluate((_electron, { entry, checkout }) => {
    const service = process.getBuiltinModule('module').createRequire(entry)(entry).gitService;
    const original = service.getStatus;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    service.__smokeGitGate = () => { service.getStatus = original; release(); delete service.__smokeGitGate; };
    service.getStatus = async function (root, ...args) { if (root === checkout) await gate; return original.call(this, root, ...args); };
  }, { entry, checkout });
  try {
    await row.click();
    await page.locator('[data-git-last-known]').waitFor();
    assert.match(await page.getByRole('button', { name: 'Source Control', exact: true }).textContent(), /test1.*2 changes.*Last known/);
    assert.equal(await page.locator('.git-badge').count(), 0, 'Cached count became an actionable dirty badge');
    const data = (await explain(id)).renderer.checkoutPresentation;
    assert.equal(data.selection.root, checkout); assert.equal(data.git.availability, 'loading');
    assert(data.git.generation > oldGeneration, 'Historical generation was reused');
    await until(async () => (await mainState(id)).poll?.workspacePath === checkout, 'Existing poll owner did not reacquire isolated checkout');
    const native = await mainState(id); assert.equal(native.generation, data.git.generation);
    await page.getByRole('button', { name: 'Source Control', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Source Control', exact: true });
    assert.equal(await dialog.getByRole('button', { name: 'Initialize Repository', exact: true }).count(), 0);
    for (const name of ['Commit Staged', 'Stage All & Commit']) assert(await dialog.getByRole('button', { name, exact: true }).isDisabled());
    assert.equal(await dialog.getByRole('button', { name: 'Stage All', exact: true }).count(), 0);
    await page.keyboard.press('Escape');
  } finally {
    await app.evaluate((_electron, entry) => process.getBuiltinModule('module').createRequire(entry)(entry).gitService.__smokeGitGate?.(), entry);
  }
  await until(async () => (await explain(id)).renderer.checkoutPresentation.git.availability === 'ready', 'Released real acquisition never became current');
  assert.equal(await page.locator('[data-git-last-known]').count(), 0);
  assert.equal(await page.locator('.git-badge').textContent(), '2');
};
