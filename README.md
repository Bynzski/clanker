# Clanker Grid

A developer workspace tool featuring a terminal grid and integrated web browser, built with Electron and React.

## Features

- **Terminal Grid**: Multiple terminal panes with flexible layout
- **Integrated Browser**: Web browser panel alongside your terminals
- **Harness Support**: Choose between different AI coding harnesses (Codex, OpenCode, Pi)
- **Multiple Workspaces**: Work on multiple projects simultaneously with workspace tabs
- **Quick Launch**: Launch directly into your workspace with configurable terminal count

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Electron

### Installation

```bash
cd clanker-grid
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

## Project Structure

```
clanker-grid/
├── src/
│   ├── main/          # Electron main process
│   └── renderer/      # React frontend
├── clanker-grid/      # Project source (nested)
└── ...
```

## License

MIT
