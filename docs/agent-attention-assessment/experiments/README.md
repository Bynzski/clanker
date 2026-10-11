# Attention assessment experiments

These scripts reproduce the experiments cited in [`../README.md`](../README.md). They use the
compiled broker, observer and renderer selector. They need no model, credentials or harness install.

```bash
# From the repository root
npm run build:shared && npm run build:main

# Experiment A: real observer in a child process vs. a broker whose event loop stalls
node docs/agent-attention-assessment/experiments/a_transport_stall.cjs

# Experiment B: provider emission sequences through the real broker + renderer selector.
# First bundle the renderer selector (esbuild is fetched on demand, not a repo dependency):
npx --yes esbuild src/renderer/lib/agentAttentionPresentation.ts --bundle --platform=node \
  --format=cjs --outfile="${TMPDIR:-/tmp}/clanker-attention-presentation.cjs" --log-level=warning
node docs/agent-attention-assessment/experiments/b_sequences.cjs
```

You can set `CLANKER_PRESENTATION_BUNDLE` to point B at a different bundle path.

Results recorded at `7d17343`:

- **A:** stall 0/300 ms → `accepted-changed`, applied. 700 ms → the hook sees failure, but the broker applied the event. 1500 ms → the hook sees failure and the broker did **not** apply the event.
- **B1:** Pi `/reload` with a lost `session_ended`. The next 5 turns are `ignored-stale`.
- **B2–B4:** Pi `/new` with a lost end, Codex `/new`, and an OpenCode new session. Every later event is `rejected-mismatch`.
- **B5:** a Claude/Codex turn ends `provisional`.
- **B6:** a foreground completion renders nothing.
- **B7/B8:** a lost start blanks one turn; a lost settle leaves the pane on Running until the next prompt.
