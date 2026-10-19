// Real Electron navigation events in an isolated profile; no user workspace is opened.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow } = require('electron');

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-file-links-smoke-'));
app.setPath('userData', path.join(fixture, 'profile'));
const root = path.join(fixture, 'workspace');
fs.mkdirSync(root);
const start = pathToFileURL(path.join(root, 'index.html')).href;
const target = pathToFileURL(path.join(root, 'page two.html')).href;
const outside = pathToFileURL(path.join(fixture, 'outside.html')).href;
fs.writeFileSync(path.join(root, 'index.html'), `<a id="relative" href="page%20two.html#section">Next</a>
<a id="popup" target="_blank" href="page%20two.html">Popup</a>
<a id="outside" href="${outside}">Outside</a>`);
fs.writeFileSync(path.join(root, 'page two.html'), '<title>Second page</title><p id="section">Second</p>');
fs.writeFileSync(path.join(fixture, 'outside.html'), '<title>Outside</title>');
let localRoot = root;
const server = http.createServer((request, response) => {
  if (request.url === '/redirect') {
    response.writeHead(302, { Location: target });
    response.end();
  } else {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<a id="file" href="${target}">File</a><a id="popup" target="_blank" href="${target}">Popup</a>`);
  }
});
let window;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await pause(30);
  }
  throw new Error(label);
}

async function run() {
  await app.whenReady();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const remote = `http://127.0.0.1:${server.address().port}/`;
  const browserIpcPath = path.join(__dirname, '../dist/main/main/ipc/browserIpc.js');
  const { createBrowserViewForTab } = require(browserIpcPath);
  window = new BrowserWindow({ show: false });
  const entry = createBrowserViewForTab('fixture', 'files', {
    getMainWindow: () => window,
    getBrowserViews: () => new Map(),
    getLocalWorkspaceRoot: () => localRoot,
    getActiveBrowserWorkspaceId: () => 'fixture',
    setActiveBrowserWorkspaceId: () => {},
  });
  const contents = entry.view.webContents;
  const click = id => contents.executeJavaScript(`document.getElementById(${JSON.stringify(id)}).click()`, true);
  const reset = () => contents.loadURL(start);
  await reset();
  await click('relative');
  await until(() => entry.url === `${target}#section`, 'Relative file link or URL reporting failed');
  await contents.executeJavaScript("location.hash = 'other'");
  await until(() => entry.url === `${target}#other`, 'File anchor URL reporting failed');
  await reset();
  await click('popup');
  await until(() => entry.url === target, 'Local popup link failed');
  assert.equal(BrowserWindow.getAllWindows().length, 1, 'Unexpected popup window');
  await reset();
  await click('outside');
  await pause(150);
  assert.equal(contents.getURL(), start, 'Workspace escape');
  localRoot = null;
  await click('relative');
  await pause(150);
  assert.equal(contents.getURL(), start, 'Revoked root retained file authority');
  localRoot = root;
  await contents.loadURL(remote);
  await click('file');
  await click('popup');
  await pause(150);
  assert.equal(contents.getURL(), remote, 'Remote file pivot');
  await contents.loadURL(`${remote}redirect`).catch(() => {});
  assert.notEqual(contents.getURL(), target, 'Redirect file pivot');
  await reset();
  await contents.executeJavaScript(`new Promise(resolve => {
    const frame = document.createElement('iframe');
    frame.src = ${JSON.stringify(remote)}; frame.onload = resolve; document.body.append(frame);
  })`);
  const remoteFrame = contents.mainFrame.frames.find(frame => frame.url === remote);
  assert.ok(remoteFrame, 'Remote frame fixture did not load');
  await remoteFrame.executeJavaScript(`window.open(${JSON.stringify(target)}); top.location = ${JSON.stringify(target)}`);
  await pause(150);
  assert.equal(contents.getURL(), start, 'Remote iframe file pivot');
  console.log('PASS: relative/encoded file links, anchors, popup routing, URL reporting, confinement, revocation, remote/iframe/redirect pivots');
}

const deadline = setTimeout(() => { console.error('File-link smoke timed out'); app.exit(1); }, 20000);
run().then(() => { process.exitCode = 0; }).catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  clearTimeout(deadline);
  window?.destroy();
  server.close();
  fs.rmSync(fixture, { recursive: true, force: true });
  app.exit(process.exitCode ?? 0);
});
