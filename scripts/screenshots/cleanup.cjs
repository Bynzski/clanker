// Linux capture-only cleanup for native Codex daemons that outlive their PTY.
// Never signal a process unless its executable is inside this run's fresh HOME.
const fs = require('node:fs');
const path = require('node:path');
async function stopOwnedCodexDaemons(root) {
  if (process.platform !== 'linux') return;
  const prefix = path.join(root, 'home', '.codex', 'packages') + path.sep;
  const owned = pid => {
    try {
      const argv = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
      return argv[0].startsWith(prefix) && path.basename(argv[0]) === 'codex' && argv.includes('app-server');
    } catch { return false; }
  };
  const pids = fs.readdirSync('/proc').filter(pid => /^\d+$/.test(pid) && owned(pid));
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    for (const pid of pids) {
      if (owned(pid)) { try { process.kill(Number(pid), signal); } catch { /* Already exited. */ } }
    }
    await new Promise(resolve => setTimeout(resolve, 400));
  }
}
module.exports = { stopOwnedCodexDaemons };
