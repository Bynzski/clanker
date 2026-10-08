# Feature screenshots and clips

Run `npm ci`, then `npm run capture:features` from the app repository. This builds
and launches the real Electron app through Playwright. Linux is the supported
capture platform; clips require `ffmpeg` with libx264 on PATH. Playwright uses the
project's Electron binary, so no Playwright browser download is needed.

Outputs: `docs/screenshots/YYYY-MM-DD-features/` with PNGs, silent MP4 clips,
`README.md`, `manifest.json`, and an offline `index.html` gallery for choosing
assets. No website changes or deployment are performed.
A repeated date overwrites matching assets; use a new date to preserve a set.
Only the first requested theme records clips; all requested themes get PNGs.

```bash
CAPTURE_THEMES=dark npm run capture:features
CAPTURE_DATE=2026-10-08 npm run capture:features
npm run capture:features -- --no-clips
CAPTURE_THEMES=dark npm run capture:features -- --preview-only
```

`CAPTURE_KEEP_FIXTURE=1` retains disposable profiles/projects for debugging.

## Authenticity and privacy

- Fresh HOME, configuration, cache, data and Electron profiles. Only allowlisted
  transport/runtime environment variables are inherited. Never copies accounts.
- Real disposable Git repos: source tree, Node tests, commit history, dirty files,
  three branches and one linked worktree. A dependency-free local HTTP preview
  runs via the app's actual Dev Server feature.
- Real UI actions and preload IPC. No mocked bridge or injected app styles.
- Codex, Claude and Pi must be installed on PATH for harness scenes. Installed
  CLI paths can appear in their own output even with an isolated HOME. They are
  launched without model prompts; screenshots show their real onboarding state,
  not productive AI activity. Native hook integrations may appear in their UI.
- Usage is restricted to home-isolated Codex/Claude adapters and is intentionally
  unauthenticated. Other providers are disabled in the disposable profile before
  launch: some CLIs can use OS/shared authentication despite a blank HOME.
  Populated subscription quotas require a separately approved demo-account
  capture; do not invent them.
- Browser pixels come from the actual native WebContentsView and are composited
  at Electron's reported bounds, including in clips. Frames are sampled serially
  at about 4 fps, using their actual durations, then encoded at 24 fps for broadly
  compatible playback. This suits short UI tours, not smooth terminal animation.
- Menus which hide the native browser are captured without a hidden view overlay.
- Cleanup closes Electron through its normal lifecycle, kills captured terminals
  and removes the disposable fixture. Native Codex daemons can outlive their
  terminal; on Linux the runner also terminates only daemon executables inside
  this run's fresh HOME. Failed runs leave an incomplete manifest.

Review every output before publishing. The manifest records source revision,
version, dimensions, feature descriptions and completion status. Historical PNGs
remain intact. The website can map selected files into its own public assets;
its current release sync only reads committed assets from published app releases.
Clips should retain static PNG fallbacks/posters, controls and descriptive captions.

Coverage is local only: no SSH, authenticated quota, real model conversations,
Assistant service, or live annotation-to-agent handoff is claimed.
