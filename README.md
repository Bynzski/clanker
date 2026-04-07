# Clanker Grid

A developer workspace tool featuring multi-workspace terminal layouts, AI harness launchers, git controls, and an integrated browser, built with Electron and React.

## Features

- **Terminal Grid**: Multiple terminal panes with flexible layout
- **Integrated Browser**: Web browser panel alongside your terminals
- **Harness Support**: Choose between Codex, Claude, OpenCode, Pi, or a plain shell terminal
- **Multiple Workspaces**: Work on multiple projects simultaneously with workspace tabs
- **Quick Launch**: Launch directly into your workspace with configurable terminal count
- **Git Tools**: Branch, stash, merge, history, diff, and AI-assisted commit message flows

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Validation

```bash
npm run validate
```

## Project Structure

```
.
├── src/
│   ├── main/          # Electron main process
│   └── renderer/      # React frontend
├── dist/              # Built renderer
├── build/             # Build resources
├── node_modules/
├── package.json
└── ...
```

## License

MIT
