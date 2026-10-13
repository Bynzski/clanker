const path = require('node:path');
// Fixture-only instrumentation of actual backend calls, not IPC notifications. Pauses
// the existing timer (without changing its identity) to isolate required mutation reads.
module.exports = async (app, repo) => {
  const entry = path.join(repo, 'dist/main/main/main.js');
  await app.evaluate((_electron, entry) => {
    const service = process.getBuiltinModule('module').createRequire(entry)(entry).gitService;
    const meter = { counts: {}, statusSources: {}, active: 0, peak: 0 };
    const start = service.startPolling;
    service.startPolling = function (...args) { const value = start.apply(this, args); clearInterval(this.pollingInterval); this.pollingInterval = null; return value; };
    clearInterval(service.pollingInterval); service.pollingInterval = null;
    for (const name of ['getStatus', 'getBranchState', 'getOperationState', 'getHistory', 'listStashes', 'getRemotes', 'getDiff', 'stage', 'unstage', 'commit']) {
      const original = service[name];
      service[name] = async function (...args) {
        meter.counts[name] = (meter.counts[name] || 0) + 1;
        if (name === 'getStatus') {
          // Classify only fixed call-site names; never retain stack paths or payloads.
          const stack = new Error().stack || '';
          const source = stack.includes('refreshGitStatus') ? 'mutation' : stack.includes('triggerGitStatusRefresh') ? 'watcher'
            : stack.includes('processStatusUpdates') ? 'poll' : stack.includes('gitIpc.js') ? 'manual' : 'other';
          meter.statusSources[source] = (meter.statusSources[source] || 0) + 1;
        }
        const read = !['stage', 'unstage', 'commit'].includes(name);
        if (read) { meter.active++; meter.peak = Math.max(meter.peak, meter.active); }
        try { return await original.apply(this, args); } finally { if (read) meter.active--; }
      };
    }
    service.__sourceMeter = meter;
  }, entry);
  return () => app.evaluate((_electron, entry) => {
    const service = process.getBuiltinModule('module').createRequire(entry)(entry).gitService;
    return JSON.parse(JSON.stringify(service.__sourceMeter));
  }, entry);
};
