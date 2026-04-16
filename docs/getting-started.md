# Getting Started

## Installation

```bash
git clone <repo-url>
cd <repo-directory>
npm install
```

## First Launch

1. Run `npm run dev`
2. The workspace gate opens if no workspaces exist
3. Select or enter a directory path
4. Optionally select an AI harness
5. If a harness is selected, choose a model via the compact model picker
6. Choose terminal count (1, 2, or 4)
7. Click **Launch**

### Model Selection in the Gate

When a harness is selected, the gate shows a compact model pill displaying the current default model:

- **Click the pill** to open the favorites picker (shows pinned models)
- **"Browse all models"** to search the full model list
- **Select a model** to use it for this workspace launch

The default model for each harness can be configured in the header settings dropdown (gear icon).

## Creating Workspaces

From the gate or header toolbar:
- Click **Open Workspace**
- Enter a local directory path
- Directory autocomplete is available

## Navigation

| Element | Location |
|---------|----------|
| Title Bar | Top — window controls |
| Workspace Tabs | Below title bar |
| Header Toolbar | Tabs → main content |
| Main Area | Terminals, browser, editor, and file explorer |
| Status Bar | Bottom |

## Quick Commands

| Command | Action |
|---------|--------|
| `npm run dev` | Start development |
| `npm run build` | Build for production |
| `npm run test` | Run tests |
| `npm run validate` | Full validation |
