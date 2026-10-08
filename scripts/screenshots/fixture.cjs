const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function createProject(root, name, html) {
  const dir = path.join(root, name);
  const files = {
    'README.md': `# ${name}\n\nA disposable Northstar project for Clanker Grid demos.\n\n## Development\n\nRun \`npm run dev\`, then open the local preview.\n\n## Checklist\n\n- [x] Project dashboard\n- [x] Accessible navigation\n- [ ] Search and filtering\n`,
    '.gitignore': 'node_modules/\n',
    'package.json': JSON.stringify({ name, version: '1.0.0', private: true, scripts: { dev: 'node server.cjs', test: 'node --test tests/*.test.cjs' } }, null, 2) + '\n',
    'server.cjs': `const http = require('node:http');\nconst fs = require('node:fs');\nconst server = http.createServer((_req, res) => {\n  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });\n  let html = fs.readFileSync(__dirname + '/public/index.html', 'utf8');\n  if (_req.url === '/guide') html = html.replace('Northstar — Developer workspace', 'Northstar — Project guide').replace('Good ideas.<br>One place to build them.', 'Project guide.<br>Build with confidence.');\n  res.end(html);\n});\nserver.listen(0, '127.0.0.1', () => {\n  console.log('Northstar preview ready: http://127.0.0.1:' + server.address().port);\n});\n`,
    'public/index.html': html,
    'src/projects.ts': `export interface Project {\n  id: string;\n  name: string;\n  status: 'ready' | 'review' | 'building';\n}\n\nexport const projects: Project[] = [\n  { id: 'dashboard', name: 'Workspace navigation', status: 'ready' },\n  { id: 'api', name: 'API integration', status: 'review' },\n  { id: 'docs', name: 'Documentation', status: 'building' },\n];\n\nexport function findProject(id: string): Project | undefined {\n  return projects.find((project) => project.id === id);\n}\n`,
    'src/search.cjs': `exports.search = (projects, query) => projects.filter(\n  (project) => project.name.toLowerCase().includes(query.toLowerCase())\n);\n`,
    'tests/search.test.cjs': `const { test } = require('node:test');\nconst assert = require('node:assert/strict');\nconst { search } = require('../src/search.cjs');\ntest('search matches project names without case sensitivity', () => {\n  assert.deepEqual(search([{ name: 'Dashboard' }], 'dash'), [{ name: 'Dashboard' }]);\n});\ntest('unknown projects return no results', () => {\n  assert.deepEqual(search([{ name: 'Dashboard' }], 'billing'), []);\n});\n`,
    'docs/architecture.md': '# Architecture\n\nThe dashboard displays projects from the local API. Search is a pure function tested with Node’s built-in test runner.\n',
  };
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe', env: { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
  git('init', '-b', 'main');
  git('config', 'user.name', 'Northstar Demo');
  git('config', 'user.email', 'demo@example.invalid');
  git('add', '.'); git('commit', '-m', 'Create project dashboard and local preview');
  fs.appendFileSync(path.join(dir, 'docs/architecture.md'), '\n## Quality checks\n\nRun `npm test` before submitting changes.\n');
  git('add', '.'); git('commit', '-m', 'Document development quality checks');
  for (const branch of ['feat/project-search', 'docs/getting-started', 'fix/keyboard-navigation']) git('branch', branch);
  git('worktree', 'add', path.join(root, `${name}-worktrees`, 'project-search'), 'feat/project-search');
  fs.appendFileSync(path.join(dir, 'src/projects.ts'), '\n// Next: expose project status filters in the dashboard.\n');
  fs.writeFileSync(path.join(dir, 'docs/release-notes.md'), '# Release notes\n\nAdd project filtering and keyboard navigation.\n');
  return dir;
}
module.exports = { createProject };
