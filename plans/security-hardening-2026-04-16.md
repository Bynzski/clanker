# Plan: Security Hardening — Credential Fallback & Dependency Scanning

**Created:** 2026-04-16
**Status:** Complete

## Context

The security audit identified two actionable items that should be addressed before production deployment:

1. **Credential encryption fallback is weak** — When `safeStorage` is unavailable, PATs are stored with base64 encoding (not encryption). This means any process with file read access to the electron-store data could trivially decode stored tokens.

2. **No automated dependency scanning** — The project has no `npm audit` or equivalent in CI, which means known CVEs in dependencies (especially `electron` and `node-pty`) go undetected until manual review.

## Goals

- [ ] Credential storage refuses to fall back to base64 encoding when `safeStorage` is unavailable
- [ ] Dependency vulnerability scanning is integrated into the project's validation pipeline
- [ ] All lint, typecheck, build, and test commands continue to pass after changes

## Slices

### Slice 1: Harden credential fallback — refuse weak encryption

**Bounding:** Replaces the base64 credential fallback in `credentialService.ts` with a refusal to store tokens when encryption is unavailable. The `savePat` function will return an error instead of storing a weakly-protected token. Existing tests are updated to cover the new behavior.

**Dependencies:** None

**Steps:**

1. Modify `src/main/credential/credentialService.ts` — In the `savePat` function, remove the base64 fallback block and instead return an error when `encryptionAvailable` is false:

   ```typescript
   // Find and replace the fallback block (around lines 199-203)
   // BEFORE:
   if (!encryptionAvailable) {
     console.warn('safeStorage not available, using basic storage');
     const encoded = Buffer.from(token).toString('base64');
     storeSet(`encryptedPats.${provider}`, encoded);
   } else {
     // Encrypt and store
     const encrypted = _testSafeStorage
       ? _testSafeStorage.encryptString(token)
       : safeStorage.encryptString(token);
     storeSet(`encryptedPats.${provider}`, encrypted.toString('base64'));
   }

   // AFTER:
   if (!encryptionAvailable) {
     return {
       success: false,
       error: 'Secure storage is not available on this system. Credential storage requires OS-level encryption support.',
     };
   }
   const encrypted = _testSafeStorage
     ? _testSafeStorage.encryptString(token)
     : safeStorage.encryptString(token);
   storeSet(`encryptedPats.${provider}`, encrypted.toString('base64'));
   ```

2. Update the test in `tests/main/unit/credentialService.test.ts` — Find the test that exercises the fallback path (or add one if missing). The test should assert that `savePat` returns `{ success: false, error: ... }` when `_testSafeStorage.isEncryptionAvailable()` returns `false`.

**Verification:** `npm run validate` passes with no errors. The `savePat` function with encryption unavailable returns an error rather than storing base64-encoded tokens.

---

### Slice 2: Add dependency vulnerability scanning to validation pipeline

**Bounding:** Adds `npm audit` as a new script and incorporates it into the `validate` pipeline. The scan runs with `--audit-level=high` so it fails on high/critical severity vulnerabilities but passes on low/medium (which can be addressed separately). No other changes are made in this slice.

**Dependencies:** None

**Steps:**

1. Add a `security-check` script to `package.json`:

   ```json
   "scripts": {
     "security-check": "npm audit --audit-level=high",
   }
   ```

2. Modify the `validate` script in `package.json` to include `security-check` as a step:

   ```json
   "scripts": {
     "validate": "npm run lint && npm run typecheck && npm run security-check && npm run build && npm run test",
   }
   ```

3. Verify the pipeline works by running `npm run security-check` locally. If it fails due to existing vulnerabilities in dependencies, document them as a known issue separate from this plan.

**Verification:** `npm run validate` passes (or fails with a clear list of vulnerable packages if the project has pre-existing issues). Running `npm run security-check` alone produces a clean report or a documented list of known vulnerabilities.

---

## Blockers

> **Blocking changes** are prerequisites that must be resolved before reliable work can begin.

- [ ] **None** — Both slices are independent and can be implemented without external dependencies.

## File Inventory

| File | Action | Purpose |
|------|--------|---------|
| `src/main/credential/credentialService.ts` | Modify | Remove base64 credential fallback; return error when encryption unavailable |
| `tests/main/unit/credentialService.test.ts` | Modify | Add/update test coverage for encryption-unavailable path |
| `package.json` | Modify | Add `security-check` script and incorporate it into `validate` pipeline |

## Risks & Assumptions

- **Assumption:** `safeStorage` is available on all target platforms (Windows, macOS, Linux with encryption support). This is true for the primary target platforms, but some Linux environments without a keyring daemon may not support it.
- **Risk:** Adding `npm audit` to `validate` may cause CI to fail on the first run if there are existing high/critical CVEs in dependencies. If this occurs, the fix is to update the affected packages (`npm audit fix`) or acknowledge the vulnerabilities in a `VULNERABILITIES.md` file if they cannot be resolved immediately.
- **Risk:** `electron-store` uses a library-level encryption key (`encryptionKey: 'clanker-grid-vcs'`). This is not a user secret but does provide a layer of obfuscation. Removing the base64 fallback means no tokens are stored when `safeStorage` is unavailable — this is intentional but means users on systems without `safeStorage` cannot use the VCS credential features.

## Next Steps

1. Review the plan and confirm both slices are in scope
2. Begin with **Slice 1** (credential hardening) as it addresses the most critical security issue
3. After Slice 1 is verified with `npm run validate`, proceed to **Slice 2** (dependency scanning)
4. Run `npm run validate` as the final check before considering the plan complete