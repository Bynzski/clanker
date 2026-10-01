import ts from 'typescript';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KNOWN_HARNESS_IDS } from '../../../src/shared/harnessIds';

// Provider implementations own harness dispatch. Scan every other main module,
// including future orchestrators; scalar identity defaults remain valid.
function discoverSharedMainFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) return entry.name === 'harnesses' ? [] : discoverSharedMainFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}
function dispatchLiterals(source: string): string[] {
  const tree = ts.createSourceFile('orchestrator.ts', source, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];
  const ids: ReadonlySet<string> = new Set(KNOWN_HARNESS_IDS);
  function visit(node: ts.Node): void {
    if (ts.isStringLiteralLike(node) && ids.has(node.text)) {
      const parent = node.parent;
      if (ts.isArrayLiteralExpression(parent) || ts.isCaseClause(parent)
        || (ts.isBinaryExpression(parent) && [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(parent.operatorToken.kind))
        || (ts.isPropertyAssignment(parent) && parent.name === node)) violations.push(node.text);
    }
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && ids.has(node.name.text)) violations.push(node.name.text);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return violations;
}
describe('harness architecture boundaries', () => {
  it('automatically checks every shared main module for harness dispatch', () => {
    for (const file of discoverSharedMainFiles(resolve('src/main'))) {
      expect(dispatchLiterals(readFileSync(file, 'utf8')), file).toEqual([]);
    }
  });
  it.each([
    "const supported = ['codex', 'pi'];",
    "['codex', 'pi'].includes(harness)",
    "if (harness === 'codex') launch()",
    "const supported = new Set(['codex', 'pi']); supported.has(harness)",
    "if ('codex' === harness) launch()",
    "switch(harness) { case 'pi': launch() }",
    "const dispatch = { codex: launch, 'pi': launch }",
  ])('rejects literal capability dispatch: %s', (source) => {
    const root = mkdtempSync(resolve(tmpdir(), 'clanker-architecture-'));
    try {
      mkdirSync(resolve(root, 'future'));
      const file = resolve(root, 'future/harnessUsage.ts');
      writeFileSync(file, source);
      mkdirSync(resolve(root, 'harnesses'));
      writeFileSync(resolve(root, 'harnesses/provider.ts'), source);
      const discovered = discoverSharedMainFiles(root);
      expect(discovered).toEqual([file]);
      expect(dispatchLiterals(readFileSync(discovered[0], 'utf8')).length).toBeGreaterThan(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('allows scalar identity metadata, comments and descriptive text', () => {
    expect(dispatchLiterals("const defaults = { aiCommitProvider: 'codex' }; // pi\nconst description = 'Codex and Pi';")).toEqual([]);
  });
});
