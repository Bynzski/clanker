// Real Chromium regression: cookies ignore ports, session partitions must isolate them.
// Run after build: node_modules/.bin/electron scripts/ssh-preview-session-smoke.cjs
const { app, WebContentsView } = require('electron');
const { createServer } = require('node:http');
const { createServer: createTlsServer } = require('node:https');
const { mkdtempSync, rmSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const { BrowserSessionScopes } = require('../dist/main/main/browserSessionScope');
const profile = mkdtempSync(join(tmpdir(), 'clanker-session-smoke-'));
app.setPath('userData', profile);
app.whenReady().then(async () => {
  const server = createServer((_req, res) => res.end('<!doctype html><title>Isolation fixture</title>'));
  const tls = createTlsServer({ key: readFileSync(join(__dirname, '../tests/fixtures/ssh-preview/key.pem')), cert: readFileSync(join(__dirname, '../tests/fixtures/ssh-preview/cert.pem')) }, (_req, res) => res.end('TLS fixture'));
  const scopes = new BrowserSessionScopes(), views = [];
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/`;
    for (const id of ['ssh-a', 'ssh-b', 'ssh-a']) {
      const view = new WebContentsView({ webPreferences: { partition: scopes.partition(id, 'ssh'), sandbox: true, contextIsolation: true } });
      views.push(view); scopes.attach(id, view.webContents.session);
      await view.webContents.loadURL(url);
    }
    await views[0].webContents.executeJavaScript("document.cookie='preview_auth=secret; path=/'; localStorage.setItem('preview_auth','secret')");
    const read = (v) => v.webContents.executeJavaScript("JSON.stringify({cookie:document.cookie,storage:localStorage.getItem('preview_auth')})");
    assert.deepEqual(JSON.parse(await read(views[1])), { cookie: '', storage: null });
    assert.deepEqual(JSON.parse(await read(views[2])), { cookie: 'preview_auth=secret', storage: 'secret' });
    // Explicitly show port differences do not isolate cookies within the same session.
    assert.equal((await views[0].webContents.session.cookies.get({ url: 'http://127.0.0.1:5173/' }))[0].value, 'secret');
    assert.equal((await views[1].webContents.session.cookies.get({ url: 'http://127.0.0.1:4000/' })).length, 0);
    assert.equal(scopes.partition('local-a', 'local'), scopes.partition('local-b', 'local'));
    await new Promise((resolve) => tls.listen(0, '127.0.0.1', resolve));
    await assert.rejects(views[1].webContents.loadURL(`https://127.0.0.1:${tls.address().port}/`), /ERR_CERT_/);
    console.log('PASS real Chromium: untrusted development HTTPS remains rejected');
    console.log('PASS real Chromium: cross-workspace cookies/localStorage isolated; same-workspace tabs share state; local global scope retained');
  } finally {
    for (const view of views) view.webContents.close();
    scopes.disposeAll(); await Promise.all([new Promise((resolve) => server.close(resolve)), new Promise((resolve) => tls.close(resolve))]);
  }
}).then(() => app.quit(), (error) => { console.error(error); app.exit(1); });
app.on('will-quit', () => { rmSync(profile, { recursive: true, force: true }); });
