# tui-devtools

DevTools for Ink TUI apps — component tree, state inspection, console capture.

Built for AI agents that need to debug terminal UI applications programmatically.

## Why

Tools like `agent-tui` can automate TUI apps (press keys, take screenshots), but they can only see the **screen output**. When something goes wrong, there's no way to inspect component state, view console errors, or understand the component hierarchy.

`tui-devtools` bridges this gap for **Ink (React)** apps by connecting to React DevTools protocol.

## Quick Start

```bash
# Install
npm install -g tui-devtools

# 1. Start the DevTools server
tui-devtools start

# 2. Run your Ink app with DEV=true
DEV=true npx my-ink-app

# 3. Inspect
tui-devtools tree                    # Component hierarchy
tui-devtools inspect CommandMode     # Props & state of a component
tui-devtools logs                    # Console output
tui-devtools logs --level error      # Only errors

# 4. Cleanup
tui-devtools stop
```

## Commands

| Command | Description |
|---------|-------------|
| `start` | Start DevTools server daemon |
| `stop` | Stop daemon |
| `status` | Show connection status |
| `tree` | Print component tree |
| `inspect <name>` | Show props/state/hooks for a component |
| `find <name>` | Find components by name |
| `logs` | Show captured console logs |

## With agent-tui (AI Agent Workflow)

```bash
# Start devtools first
tui-devtools -s myapp start

# Start the TUI app
agent-tui run -s myapp "DEV=true npx my-ink-app"

# Visual: what's on screen
agent-tui -s myapp screenshot

# Structural: what's in React
tui-devtools -s myapp tree

# Debug: what went wrong
tui-devtools -s myapp logs --level error
tui-devtools -s myapp inspect MyComponent --json
```

## How It Works

```
Ink App (DEV=true)                    tui-devtools daemon
─────────────────                    ──────────────────
react-devtools-core                  WebSocket server (:8097)
  connectToDevTools() ──WebSocket──► Parse fiber tree operations
                                     Store component tree + logs
                                          │
                                     Unix socket IPC
                                          │
                                     CLI commands ◄── AI agent
```

## Options

```
-s, --session <name>    Session name (default: "default")
-p, --port <port>       DevTools port (default: 8097)
--json                  JSON output for all commands
```

## Requirements

- Node.js >= 18
- Target app must use **Ink** (React-based TUI framework)
- `react-devtools-core` must be installed in the target app
- Run the app with `DEV=true` environment variable

## License

MIT
