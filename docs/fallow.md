# Fallow maintenance checks

Use the lockfile-installed Fallow version (currently 2.56.0):

```bash
npm ci
npm run fallow:report
npm run fallow:report:production
npm run fallow:check
```

The report commands emit JSON and retain all findings. Production mode excludes tests/development files; its estimated coverage/CRAP scores are not comparable to the full scan's. Neither command supplies measured coverage.

`fallow:check` runs uncached dead-code analysis against the issue-identity baseline in `docs/evidence/fallow-dead-code-baseline.json`. It runs in `npm run validate` and Ubuntu CI. New findings fail, while the reviewed backlog is accepted. An identity baseline is used instead of count-only regression detection: fixing one old issue must not permit an unrelated new issue. Fallow 2.56's count-regression flag still exits nonzero for existing dead-code findings, so it is not suitable for accepting this backlog.

## Reviewed baseline

The initial baseline was captured after the targeted 2026-10-07 cleanup, based on commit `f063195`: 2 unused test helpers, 18 value exports and 37 type exports. These are accepted cleanup candidates, not claims that deletion is safe. The gate was verified to pass unchanged findings and fail a temporary newly introduced unused source file. Remove baseline entries as their underlying findings are resolved. Do not automatically refresh it in CI.

To deliberately regenerate it after reviewing every newly accepted finding:

```bash
npx --no-install fallow dead-code --no-cache --save-baseline docs/evidence/fallow-dead-code-baseline.json
```

The save command may exit 1 because existing findings remain; inspect the output and the baseline diff rather than ignoring arbitrary command failures.

## Narrow compatibility exceptions

`.fallowrc.json` makes the four standalone smoke scripts explicit entries. Three load generated `dist/main` modules, so unresolved-import checking is disabled only for those three scripts. This does not mean the scripts were executed by Fallow or validation.

`@modelcontextprotocol/sdk` is directly used by `src/main/agentBridge/server.ts`, and its imported subpaths resolve in Node and TypeScript. Fallow 2.56 misclassifies those subpaths and consequently reports the package unused. Dependency-ignore applies to that exact package; unresolved-import checking is disabled only for that server file. Recheck these exceptions on a Fallow upgrade. Build/typecheck remain responsible for detecting broken imports there.

`node:sqlite` is a Node builtin, not an installable missing dependency; it is ignored by exact dependency name. The existing renderer declaration-file unresolved-import override is retained.

No broad source exclusion, global unresolved-import disabling, complexity suppression, or new dependency removal was introduced. Architecture boundary rules remain unconfigured; a zero boundary count is not architectural proof.

Historical repository measurements and completed cleanup reports remain in Git history. Use fresh report output, not old grades or test counts, when assessing the current tree.
