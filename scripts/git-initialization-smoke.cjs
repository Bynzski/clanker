// Built Electron + real Git/IPC/UI. Optional live SSH uses only a unique disposable fixture.
// CLANKER_SMOKE_SSH_TARGET=user@host npm run smoke:git-init
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-init-smoke-'));
const screenshots = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-init-visual-'));
const sshTarget = process.env.CLANKER_SMOKE_SSH_TARGET;
const quote = value => `'${value.replace(/'/g, `'\\''`)}'`;
const ssh = command => execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', sshTarget, command], { encoding: 'utf8', timeout: 30000 });
const python = script => ssh(`python3 -c ${quote(script)}`).trim();
let remoteRoot;
let app;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) { const end = Date.now() + 20000; while (!await check()) { if (Date.now() > end) throw new Error(message); await pause(70); } }
(async () => {
  try {
    if (sshTarget) {
      assert(!sshTarget.startsWith('-') && !/[\r\n]/.test(sshTarget));
      remoteRoot = python('import os,tempfile\nbase=os.path.expanduser("~/workspaces")\nassert os.path.realpath(base)==base and os.path.isdir(base+"/clanker-test")\nroot=tempfile.mkdtemp(prefix="clanker-smoke-init-",dir=base)\nos.mkdir(root+"/project")\nprint(root)');
      console.log(`Live SSH disposable fixture: ${remoteRoot}`);
    }
    for (const remote of [false, ...(sshTarget ? [true] : [])]) {
      const name = remote ? 'ssh' : 'local';
      const sandbox = path.join(root, name); fs.mkdirSync(sandbox);
      for (const folder of ['home', 'config', 'cache', 'data', 'profile', 'project']) fs.mkdirSync(path.join(sandbox, folder));
      const project = remote ? `${remoteRoot}/project` : path.join(sandbox, 'project');
      const git = (...args) => remote ? ssh(`cd ${quote(project)} && LC_ALL=C git ${args.map(quote).join(' ')}`).trim() : execFileSync('git', args, { cwd: project, encoding: 'utf8' }).trim();
      const chmod = mode => remote ? python(`import os\nos.chmod(${JSON.stringify(project)},${mode})`) : fs.chmodSync(project, mode);
      if (remote) python(`from pathlib import Path\nPath(${JSON.stringify(project + '/keep.txt')}).write_text('retain\\n')`);
      else fs.writeFileSync(path.join(project, 'keep.txt'), 'retain\n');
      fs.writeFileSync(path.join(sandbox, 'profile/config.json'), JSON.stringify({ workspaceNavigationMode: 'sidebar', sshEnvironments: remote ? [{ id: 'smoke-ssh', kind: 'ssh', label: 'Smoke SSH', target: sshTarget, defaultWorkspaceRoot: remoteRoot }] : [], harnessDefaults: Object.fromEntries(['codex', 'claude', 'pi', 'opencode', 'omp', 'hermes', 'agy'].map(id => [id, { model: '', favorites: [], flags: '', visible: false, usageVisible: false }])) }));
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG', 'SSH_AUTH_SOCK'].includes(key)));
      Object.assign(env, { NODE_ENV: 'production', ELECTRON_RUN_AS_NODE: '', HOME: path.join(sandbox, 'home'), XDG_CONFIG_HOME: path.join(sandbox, 'config'), XDG_CACHE_HOME: path.join(sandbox, 'cache'), XDG_DATA_HOME: path.join(sandbox, 'data'), SHELL: '/bin/bash' });
      const launch = () => electron.launch({ executablePath: path.join(repo, 'node_modules/electron/dist/electron'), args: [repo, `--user-data-dir=${path.join(sandbox, 'profile')}`, '--ozone-platform=headless'], env });
      app = await launch();
      // Shorten the production poll clock only; all Git acquisition/IPC/identity logic stays real.
      const fasterPolling = () => app.evaluate((_electron, entry) => { process.getBuiltinModule('module').createRequire(entry)(entry).gitService.pollIntervalMs = 1000; }, path.join(repo, 'dist/main/main/main.js'));
      await fasterPolling();
      let page = await app.firstWindow(); page.setDefaultTimeout(20000);
      const open = async () => {
        await page.getByRole('button', { name: 'Open Workspace', exact: true }).first().click();
        if (remote) {
          await page.getByRole('button', { name: 'Choose location: This PC', exact: true }).click();
          await page.getByRole('button', { name: `Smoke SSH, ${sshTarget}`, exact: true }).click();
        }
        await page.getByRole('textbox', { name: `${remote ? 'Remote' : 'Local'} Directory Path` }).fill(project);
        await page.getByRole('dialog').getByText('Where are we working today?').click();
        await page.getByRole('dialog').getByRole('button', { name: 'Open Workspace', exact: true }).click();
        await page.getByRole('button', { name: 'New Agent', exact: true }).waitFor();
      };
      await open();
      assert.equal(await page.getByRole('button', { name: 'New Session', exact: true }).count(), 0);
      assert.equal(await page.getByRole('group', { name: 'New agent', exact: true }).count(), 1);
      const overview = async () => {
        await page.getByRole('button', { name: 'Source Control', exact: true }).click();
        await page.getByRole('dialog', { name: 'Source Control', exact: true }).getByRole('button', { name: 'Overview', exact: true }).click();
      };
      await overview();
      const init = () => page.getByRole('button', { name: 'Initialize Repository', exact: true });
      await until(() => init().isEnabled(), 'Valid non-repository initialization disabled');
      assert(await page.getByLabel('Initial Branch', { exact: true }).isEnabled());
      // A corrupt .git directory can produce the identical diagnostic. It must stay unavailable.
      if (remote) python(`import os\nroot=${JSON.stringify(project + '/.git')}\nos.mkdir(root)\nos.mkdir(root+'/objects')\nos.mkdir(root+'/refs')`);
      else for (const folder of ['.git', '.git/objects', '.git/refs']) fs.mkdirSync(path.join(project, folder));
      await until(() => init().isDisabled(), 'Corrupt metadata allowed initialization');
      if (remote) python(`import os\nroot=${JSON.stringify(project + '/.git')}\nos.rmdir(root+'/objects')\nos.rmdir(root+'/refs')\nos.rmdir(root)`);
      else for (const folder of ['.git/objects', '.git/refs', '.git']) fs.rmdirSync(path.join(project, folder));
      await until(() => init().isEnabled(), 'Empty directory did not recover after corrupt fixture removal');
      // The directory remains readable, but Git cannot create .git. No fake backend response.
      chmod(0o555);
      await init().click();
      await page.getByText(/Failed to initialize repository|could not create|Permission denied/i).first().waitFor();
      chmod(0o700);
      await init().click();
      await until(() => page.getByRole('dialog', { name: 'Source Control', exact: true }).count().then(count => count === 0), 'Initialization failed to refresh and close');
      assert.equal(git('symbolic-ref', '--short', 'HEAD'), 'main');
      git('add', 'keep.txt'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Init');
      // Main workspace repository state updates immediately; no closing/reopening needed.
      await page.getByRole('button', { name: 'New Agent', exact: true }).click();
      await page.getByRole('radio', { name: 'Terminal', exact: true }).waitFor();
      await page.getByLabel('New branch', { exact: true }).fill('init-worktree');
      await page.getByRole('button', { name: 'Create worktree only', exact: true }).click();
      await page.locator('.new-session-popover').waitFor({ state: 'hidden' });
      assert(git('worktree', 'list', '--porcelain').includes('branch refs/heads/init-worktree'));
      // Filesystem loss is unavailable, never an initializable non-repository; recovery is truthful.
      chmod(0);
      await overview();
      await until(async () => await init().count() > 0 && await init().isDisabled(), 'Inaccessible root allowed initialization');
      await page.getByText('Repository status unavailable. Wait for polling or reopen after refreshing the workspace.', { exact: true }).waitFor();
      chmod(0o700);
      await page.getByRole('dialog', { name: 'Source Control' }).getByText('main', { exact: true }).first().waitFor();
      await app.evaluate(async ({ BrowserWindow }, file) => { const win = BrowserWindow.getAllWindows()[0]; process.getBuiltinModule('fs').writeFileSync(file, (await win.webContents.capturePage()).toPNG()); }, path.join(screenshots, `${name}-recovered.png`));
      await page.keyboard.press('Escape');
      await app.close(); app = undefined;
      app = await launch(); await fasterPolling(); page = await app.firstWindow(); page.setDefaultTimeout(20000);
      await until(async () => await page.getByRole('button', { name: 'New Agent', exact: true }).count() > 0 || await page.getByRole('button', { name: 'Open Workspace', exact: true }).count() > 0, 'Restarted shell missing');
      if (!await page.getByRole('button', { name: 'New Agent', exact: true }).count()) await open();
      await page.getByRole('button', { name: 'New Agent', exact: true }).click();
      await page.getByRole('group', { name: 'Existing worktrees', exact: true }).getByRole('button', { name: /init-worktree/ }).waitFor();
      await page.keyboard.press('Escape');
      await overview();
      await page.getByRole('dialog', { name: 'Source Control' }).getByText('main', { exact: true }).first().waitFor();
      assert.equal(await init().count(), 0);
      await app.close(); app = undefined;
      console.log(`${name}: initialization, corrupt metadata refusal, write failure/retry, immediate worktree creation, inaccessible-root refusal/recovery and saved-profile restart passed`);
    }
    console.log(JSON.stringify({ builtElectron: true, realGit: true, liveSSH: !!sshTarget, screenshots }));
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
  finally {
    await app?.close();
    if (remoteRoot) python(`import os,re,shutil\np=${JSON.stringify(remoteRoot)}\nbase=os.path.expanduser('~/workspaces')\nassert os.path.realpath(base)==base and os.path.isdir(base+'/clanker-test')\nassert os.path.dirname(p)==base and re.fullmatch(r'clanker-smoke-init-[A-Za-z0-9_-]+',os.path.basename(p)) and os.path.realpath(p)==p\nos.chmod(p+'/project',0o700)\nshutil.rmtree(p)`);
    fs.rmSync(root, { recursive: true, force: true });
  }
})();
