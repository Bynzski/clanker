/* global window, document */
// Real installed Hermes + built Electron, isolated homes; no prompts, schedules or job execution.
// Also verifies native Bot Mode cosmetics, CAS rejection and normalized avatars (issue #182).
// npm run build && node scripts/assistant-details-smoke.cjs
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const repo = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-assistant-details-'));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG', 'LC_ALL'].includes(key)));
for (const name of ['home', 'config', 'cache', 'data', 'profile', 'hermes']) fs.mkdirSync(path.join(root, name));
// Optional explicit CLI directory for testing an installed backend runtime independently of its updater.
if (process.env.HERMES_SMOKE_BIN_DIR) env.PATH = `${process.env.HERMES_SMOKE_BIN_DIR}${path.delimiter}${env.PATH}`;
Object.assign(env, { NODE_ENV: 'production', ELECTRON_RUN_AS_NODE: '', HOME: path.join(root, 'home'), HERMES_HOME: path.join(root, 'hermes'), XDG_CONFIG_HOME: path.join(root, 'config'), XDG_CACHE_HOME: path.join(root, 'cache'), XDG_DATA_HOME: path.join(root, 'data'), SHELL: '/bin/bash' });
for (const name of ['alpha', 'beta']) {
  const profile = path.join(root, 'hermes/profiles', name);
  fs.mkdirSync(path.join(profile, 'cron'), { recursive: true });
  fs.mkdirSync(path.join(profile, 'skills/demo'), { recursive: true });
  fs.writeFileSync(path.join(profile, 'skills/demo/SKILL.md'), '---\nname: demo\ndescription: Smoke fixture\n---\nRead only fixture.\n');
  fs.writeFileSync(path.join(profile, 'config.yaml'), 'model:\n  default: fixture-model\n  provider: openrouter\nplatform_toolsets:\n  cli: [terminal]\n');
  fs.writeFileSync(path.join(profile, 'profile.yaml'), 'description: Operational fixture role\nui_meta:\n  hermes-bots:\n    hidden: false\n    groupId: smoke-group\n  unrelated:\n    intact: true\n');
  if (name === 'alpha') {
    fs.mkdirSync(path.join(profile, 'assets'));
    fs.writeFileSync(path.join(profile, 'assets/avatar.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAQCAYAAAB3AH1ZAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAALUlEQVRIiWNomrzl/0BihlEHNI1GweTRRLhlNBv+Hy2ImkaL4smjldGWAUsHAEBkkExS6IyWAAAAAElFTkSuQmCC', 'base64'));
  }
  fs.writeFileSync(path.join(profile, 'cron/jobs.json'), JSON.stringify({ jobs: [{ id: `${name}_job`, name: `${name} paused routine`, enabled: false, state: 'paused', paused_at: '2026-01-01T00:00:00+00:00', schedule: { kind: 'interval', minutes: 60 }, schedule_display: 'Every hour (fixture)', repeat: { times: null, completed: 0 }, prompt: 'Never executed', next_run_at: null, last_run_at: null, last_status: null }] }));
}
fs.writeFileSync(path.join(root, 'hermes/config.yaml'), 'model:\n  default: fixture-model\n  provider: openrouter\n');
fs.writeFileSync(path.join(root, 'profile/config.json'), JSON.stringify({ assistantSettings: { enabled: true, autoStart: true }, workspaceNavigationMode: 'sidebar' }));
let app;
(async () => {
  try {
    app = await electron.launch({ executablePath: path.join(repo, 'node_modules/electron/dist/electron'), args: [repo, `--user-data-dir=${path.join(root, 'profile')}`, '--ozone-platform=headless'], env });
    const page = await app.firstWindow(); page.setDefaultTimeout(45000);
    try { await page.getByRole('button', { name: 'Alpha', exact: true }).waitFor(); }
    catch (error) { console.error('Service diagnostics:', await page.evaluate(async () => { const snapshot = await window.electronAPI.getAssistants(); return { available: snapshot.available, settings: snapshot.settings, service: snapshot.service, names: snapshot.assistants.map(row => row.displayName) }; })); throw error; }
    const snapshot = await page.evaluate(() => window.electronAPI.getAssistants());
    assert.equal(snapshot.service.ownership, 'clanker', 'Smoke must never adopt a user backend');
    const details = await page.evaluate(() => window.electronAPI.getAssistantDetails('hermes:alpha'));
    assert.equal(details.profile.state, 'ready'); assert.equal(details.profile.data.model, 'fixture-model');
    assert.equal(details.routines.state, 'ready'); assert.equal(details.routines.data.length, 1);
    assert.equal(details.routines.data[0].id, 'alpha_job');
    const runs = await page.evaluate(() => window.electronAPI.getAssistantRoutineRuns('hermes:alpha', 'alpha_job'));
    assert.equal(runs.state, 'ready'); assert.equal(runs.data.length, 0);
    assert.notEqual((await page.evaluate(() => window.electronAPI.getAssistantRoutineRuns('hermes:beta', 'alpha_job'))).state, 'ready');
    // Native presentation before opening any chat: selected profile + visible roster only.
    const avatar = await page.evaluate(() => window.electronAPI.getAssistantAvatar('hermes:alpha'));
    assert.equal(avatar.state, 'ready'); assert.equal(avatar.data.width, 32); assert.equal(avatar.data.height, 16);
    assert(avatar.data.dataUrl.startsWith('data:image/png;base64,'));
    assert.deepEqual(await page.evaluate(() => window.electronAPI.getAssistantAvatar('hermes:beta')), { state: 'ready', data: null });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const appearanceDialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    await appearanceDialog.getByRole('button', { name: 'Assistants', exact: true }).click();
    await appearanceDialog.getByRole('combobox', { name: 'Profile' }).selectOption('hermes:alpha');
    await appearanceDialog.getByLabel('Bot title', { exact: true }).fill('Alpha Cosmetic');
    await appearanceDialog.getByLabel('Bot tagline', { exact: true }).fill('Cosmetic fixture tagline');
    await appearanceDialog.getByRole('button', { name: 'Save appearance', exact: true }).click();
    await appearanceDialog.getByText('Saved in Hermes.', { exact: true }).waitFor();
    await appearanceDialog.locator('.assistant-avatar-large img').waitFor();
    await appearanceDialog.getByLabel('Bot title', { exact: true }).scrollIntoViewIfNeeded();
    await app.evaluate(async ({ BrowserWindow }, file) => process.getBuiltinModule('fs').writeFileSync(file, (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG()), '/tmp/clanker-182-assistant-appearance.png');
    const alphaMetaPath = path.join(root, 'hermes/profiles/alpha/profile.yaml');
    const written = fs.readFileSync(alphaMetaPath, 'utf8');
    assert.match(written, /description: Operational fixture role/); assert.match(written, /groupId: smoke-group/);
    assert.match(written, /hidden: false/); assert.match(written, /intact: true/);
    assert.equal((await page.evaluate(() => window.electronAPI.getAssistants())).assistants[0].id, 'hermes:alpha');
    // Simulate another native client/file writer after the editor baseline was loaded.
    fs.writeFileSync(alphaMetaPath, 'description: Operational fixture role\nui_meta:\n  hermes-bots:\n    title: Other client title\n    description: Other client tagline\n    hidden: false\n    groupId: smoke-group\n  unrelated:\n    intact: true\n_ui_meta_revisions:\n  hermes-bots: 2\n');
    await appearanceDialog.getByLabel('Bot title', { exact: true }).fill('Stale local draft');
    await appearanceDialog.getByRole('button', { name: 'Save appearance', exact: true }).click();
    await appearanceDialog.getByText(/changed concurrently/).waitFor();
    assert.equal(await appearanceDialog.getByLabel('Bot title', { exact: true }).inputValue(), 'Other client title');
    // Restore the fixture's ordinary Alpha presentation for the existing details/roster checks.
    await appearanceDialog.getByLabel('Bot title', { exact: true }).fill('');
    await appearanceDialog.getByLabel('Bot tagline', { exact: true }).fill('');
    await appearanceDialog.getByRole('button', { name: 'Save appearance', exact: true }).click();
    await appearanceDialog.getByText('Saved in Hermes.', { exact: true }).waitFor();
    await appearanceDialog.getByRole('button', { name: 'Close Settings', exact: true }).click();
    // Zero-workspace canonical surface, then contextual navigation. No model turn is submitted.
    await page.getByRole('button', { name: 'Alpha', exact: true }).click();
    await page.getByRole('button', { name: 'Manage Assistant', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    await dialog.getByRole('combobox', { name: 'Profile' }).waitFor();
    assert.equal(await dialog.getByRole('combobox').inputValue(), 'hermes:alpha');
    await dialog.getByText('alpha paused routine', { exact: true }).waitFor();
    await dialog.getByRole('checkbox', { name: 'Hide from roster' }).check();
    await page.waitForFunction(async () => !(await window.electronAPI.getAssistants()).assistants.some(row => row.id === 'hermes:alpha'));
    assert.equal(await dialog.getByRole('combobox').inputValue(), 'hermes:alpha');
    assert.equal(await page.locator('[data-assistant-id="hermes:alpha"]').count(), 1);
    assert.equal(await page.locator('.assistant-row[aria-label="Alpha"]').count(), 0);
    await dialog.getByRole('checkbox', { name: 'Hide from roster' }).uncheck();
    await page.waitForFunction(async () => (await window.electronAPI.getAssistants()).assistants.some(row => row.id === 'hermes:alpha'));
    assert.equal(await page.locator('.assistant-row[aria-label="Alpha"]').count(), 1);
    // Create only a fixture directory: Refresh profiles must discover it, not create a real profile.
    const newcomer = path.join(root, 'hermes/profiles/gamma'); fs.mkdirSync(newcomer);
    fs.writeFileSync(path.join(newcomer, 'config.yaml'), 'model:\n  default: fixture-model\n  provider: openrouter\n');
    await dialog.getByRole('button', { name: 'Refresh profiles', exact: true }).click();
    await dialog.getByRole('option', { name: 'Gamma', exact: true }).waitFor({ state: 'attached' });
    await dialog.getByText('alpha paused routine', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Inspect recent runs' }).click();
    await dialog.getByText('No recent runs reported.', { exact: true }).waitFor();
    await dialog.getByRole('combobox').selectOption('hermes:beta');
    await dialog.getByText('beta paused routine', { exact: true }).waitFor();
    assert.equal(await dialog.getByText('alpha paused routine', { exact: true }).count(), 0);
    await app.evaluate(async ({ BrowserWindow }, file) => process.getBuiltinModule('fs').writeFileSync(file, (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG()), '/tmp/clanker-157-assistant-details.png');
    await dialog.getByRole('button', { name: 'Close Settings' }).click();
    await page.waitForFunction(() => document.activeElement?.textContent === 'Manage Assistant');
    assert(await page.getByRole('button', { name: 'Manage Assistant', exact: true }).evaluate(element => document.activeElement === element));
    console.log('Real Hermes / Electron Assistant details smoke passed: native cosmetic save, namespace preservation, concurrent edit rejection, normalized/missing avatar reads, stable Assistant identity, profile, capabilities, scoped paused routine/run reads, foreign-job refusal, zero-workspace surface, Settings deep-link, profile switch, hide/unhide while retaining the surface, discover newly added profile on refresh, focus return. Screenshots: /tmp/clanker-182-assistant-appearance.png and /tmp/clanker-157-assistant-details.png');
  } finally {
    if (app) {
      try {
        const page = await app.firstWindow();
        await page.evaluate(() => window.electronAPI.configureAssistants({ enabled: false, autoStart: false }));
        await app.evaluate(({ app }) => app.quit());
      } finally { await app.close(); }
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
