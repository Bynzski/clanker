// Real Electron/xterm geometry check; uses a temporary profile, never app state.
// Run: npx electron scripts/terminal-geometry-smoke.cjs [screenshot.png]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const { app, BrowserWindow } = require('electron');

const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-terminal-smoke-'));
app.setPath('userData', profile);
app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true }));
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const geometry = ts.transpileModule(read('src/renderer/lib/terminalGeometry.ts'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

async function run() {
  await app.whenReady();
  const window = new BrowserWindow({ width: 1000, height: 700, show: true, focusable: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  const css = read('node_modules/@xterm/xterm/css/xterm.css') + read('src/renderer/components/TerminalPane.css');
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><style>
    * { box-sizing: border-box; } body { background: #121212; color: white; }
    ${css}
    #host { width: 850px; height: 500px; } .terminal-header { height: 30px; }
  </style><div id="host"><div class="terminal-pane"><div class="terminal-header">Geometry smoke test</div><div class="terminal-content"></div></div></div>`));
  await window.webContents.executeJavaScript(read('node_modules/@xterm/xterm/lib/xterm.js'));
  await window.webContents.executeJavaScript(read('node_modules/@xterm/addon-fit/lib/addon-fit.js'));
  const result = await window.webContents.executeJavaScript(`(async () => {
    const exports = {};
    ${geometry}
    const assert = (condition, message) => { if (!condition) throw new Error(message); };
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const host = document.getElementById('host');
    const container = document.querySelector('.terminal-content');
    const terminal = new Terminal({ fontSize: 13, scrollback: 1000,
      theme: { background: '#121212', foreground: '#e8e8e8', scrollbarSliderBackground: '#3a3a3a' } });
    const fitAddon = new FitAddon.FitAddon();
    terminal.loadAddon(fitAddon); terminal.open(container);
    const calls = [], readiness = [];
    const attach = () => exports.observeTerminalGeometry({ container, fitAddon,
      resize: async (cols, rows) => { calls.push({ cols, rows }); },
      ready: async () => { readiness.push(calls.length); }, onError: error => { throw error; } });
    let sizing = attach();
    await wait(250);
    assert(calls.length === 1 && readiness[0] === 1, 'initial fit must resize once before ready');
    await new Promise(resolve => terminal.write(Array.from({length: 200}, (_, i) => 'line ' + i + '\\r\\n').join(''), resolve));
    const measurements = [];
    for (const width of [500, 300, 750]) {
      host.style.width = width + 'px';
      await wait(250);
      await new Promise(resolve => terminal.write('X'.repeat(terminal.cols) + '\\r\\n', resolve));
      const screen = terminal.element.querySelector('.xterm-screen').getBoundingClientRect();
      const scrollbar = terminal.element.querySelector('.scrollbar.vertical').getBoundingClientRect();
      const bounds = container.getBoundingClientRect();
      assert(screen.right <= bounds.right, 'rightmost column clipped: ' + JSON.stringify({ width, screen: screen.toJSON(), bounds: bounds.toJSON(), scrollbar: scrollbar.toJSON(), cols: terminal.cols, rows: terminal.rows, proposed: fitAddon.proposeDimensions(), calls }));
      assert(scrollbar.right <= bounds.right && scrollbar.width > 0, 'scrollbar clipped at width ' + width);
      assert(screen.bottom <= bounds.bottom, 'terminal screen exceeds container height');
      assert(calls.at(-1).cols === terminal.cols && calls.at(-1).rows === terminal.rows, 'PTY geometry differs from xterm');
      measurements.push({ width, cols: terminal.cols, rows: terminal.rows, scrollbarWidth: scrollbar.width });
    }
    const count = calls.length;
    host.style.display = 'none'; await wait(250);
    assert(calls.length === count, 'hidden pane sent invalid geometry');
    host.style.display = ''; await wait(250);
    assert(calls.length === count, 'unchanged visible geometry sent redundant IPC');
    sizing.dispose(); terminal.element.remove();
    const scrollback = terminal.buffer.active.length;
    host.style.width = '550px'; container.append(terminal.element); sizing = attach();
    await wait(250);
    assert(terminal.buffer.active.length >= scrollback, 'cached reattachment lost scrollback');
    assert(readiness.length === 2, 'reattachment never became ready');
    sizing.dispose();
    return { passed: true, measurements, resizeCalls: calls.length, readiness };
  })()`);
  if (process.argv[2]) fs.writeFileSync(process.argv[2], (await window.webContents.capturePage()).toPNG());
  console.log(JSON.stringify(result, null, 2));
  window.destroy();
  app.quit();
}
run().catch((error) => { console.error(error); app.exit(1); });
