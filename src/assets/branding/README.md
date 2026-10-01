# Clanker Grid branding

These four unchanged transparent PNG originals are the approved attachments from
[issue #62](https://github.com/Bynzski/clanker/issues/62#issuecomment-5929300211).
Harness and provider artwork is owned separately.

| Source | Original attachment ID | Usage |
| --- | --- | --- |
| `clanker-app-icon.png` | `4dbe88ba-b045-406f-9e8e-a213bed9dc23` | Detailed application/launcher icon; 64 px gate hero |
| `clanker-ui-icon.png` | `491f61dc-f188-483a-b761-0473f6c30c65` | Simplified title bars, New Workspace title and favicon |
| `clanker-wordmark.png` | `20c7f58f-7a5a-4a6b-b922-8152b475b5d5` | README |
| `clanker-mascot.png` | `0e6bbbb9-307d-4569-8cef-f3436cc61457` | Reserved for future larger branding placements |

Run `npm ci`, then `npm run branding:generate` to regenerate the checked-in
`generated/` assets using the pinned build-only Sharp dependency and Lanczos3
resampling. Normal builds consume these files without requiring regeneration.
Keep originals and generated files together in reviews.

The application PNGs retain the source's square canvas and complete outer frame.
The compact mark uses a centered 1004 px square from the 1254 px source to reduce
excess transparent padding while preserving the rounded frame. UI derivatives
include 16/18/20/24 px and their 2x counterparts. Renderer imports in
`src/renderer/lib/branding.ts` let Vite emit assets with correct relative URLs;
there are no manually copied public variants.

Windows ICO contains 16/24/32/48/64/128/256 px PNG frames with RGBA transparency.
ICNS contains modern PNG chunks at 16/32/64/128/256/512/1024 px. Linux packaging
uses the 512 px PNG. Electron Builder copies that same PNG to `resources/icon.png`
for packaged BrowserWindows; unpackaged windows resolve it from `app.getAppPath()`.
NSIS shortcuts and the portable executable inherit the shared Windows ICO.
