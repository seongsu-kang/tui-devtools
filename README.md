# tui-devtools

All-in-one TUI automation + DevTools for terminal apps.

Run, screenshot, interact, and inspect — built for AI agents.

## What It Does

**Works with any TUI/CLI app** — no framework dependency:

```bash
tui-devtools start                          # Start daemon
tui-devtools run "htop"                     # Run any TUI app in a PTY
tui-devtools screenshot                     # Capture screen as text
tui-devtools press q                        # Send keystrokes
tui-devtools type "hello"                   # Type text
tui-devtools wait "Ready"                   # Wait for text to appear
tui-devtools kill-session                   # Kill the app
tui-devtools stop                           # Stop daemon
```

**Bonus for Ink (React) apps** — component tree & state inspection:

```bash
tui-devtools run "DEV=true npx my-ink-app"  # Run with DevTools enabled
tui-devtools tree                            # React component hierarchy
tui-devtools inspect MyComponent             # Props, state, hooks
tui-devtools find Text                       # Search components by name
tui-devtools logs --level error              # Captured console output
```

## Install

```bash
npm install -g tui-devtools
```

## Two Layers

| Layer | Works With | What You Get |
|-------|-----------|--------------|
| **PTY Automation** | Any TUI/CLI app | run, screenshot, press, type, wait, scroll, kill |
| **React DevTools** | Ink apps + `DEV=true` | tree, inspect, find, logs |

PTY automation works universally — Ink, Bubbletea, Ratatui, htop, vim, anything that runs in a terminal. React DevTools is an **additional layer** that activates when the app supports it.

## Quick Start

### Any TUI App

```bash
tui-devtools start
tui-devtools run "npx create-next-app"
tui-devtools wait "project name"
tui-devtools type "my-app"
tui-devtools press Enter
tui-devtools screenshot
tui-devtools kill-session
tui-devtools stop
```

### Ink App with DevTools

```bash
tui-devtools start
tui-devtools run "DEV=true npx my-ink-app"
tui-devtools wait ">"

# Screen (what the user sees)
tui-devtools screenshot

# Structure (what React sees)
tui-devtools tree
tui-devtools inspect App --json

# Errors (what the console says)
tui-devtools logs --level error

tui-devtools kill-session
tui-devtools stop
```

## Commands

### PTY Automation (Universal)

| Command | Description |
|---------|-------------|
| `start` | Start daemon (WebSocket + IPC server) |
| `stop` | Stop daemon |
| `run "<command>"` | Run command in PTY (shell auto-wrapped) |
| `screenshot` | Capture current terminal screen |
| `screenshot --strip-ansi` | Without ANSI color codes |
| `press <key> [key...]` | Send keystrokes (Enter, Tab, ArrowDown, Ctrl-c, etc.) |
| `type "<text>"` | Type text |
| `wait "<text>"` | Wait for text to appear on screen |
| `wait "<text>" --timeout 5000` | With custom timeout |
| `scroll up/down [N]` | Scroll viewport |
| `kill-session` | Kill PTY process |
| `sessions` | List running PTY sessions |
| `status` | Show daemon & connection status |

### React DevTools (Ink Apps Only)

| Command | Description |
|---------|-------------|
| `tree` | Component hierarchy |
| `tree --depth N` | Limit depth |
| `tree --json` | JSON output |
| `inspect <name>` | Props, state, hooks |
| `inspect --id <N>` | By fiber ID |
| `find <name>` | Search components by name |
| `logs` | Captured console.log/warn/error |
| `logs --level error` | Filter by level |
| `logs --tail N` | Last N entries |

> React DevTools requires: `react-devtools-core` installed in the app + `DEV=true` env var.

## Key Names

| Key | Name |
|-----|------|
| Enter | `Enter` |
| Tab | `Tab` |
| Escape | `Escape` |
| Arrows | `ArrowUp` `ArrowDown` `ArrowLeft` `ArrowRight` |
| Backspace | `Backspace` |
| Space | `Space` |
| Ctrl+C | `Ctrl-c` |
| Multiple | `press ArrowDown ArrowDown Enter` |

## Session Management

```bash
# Daemon-level sessions (-s) for isolation
tui-devtools -s project1 start
tui-devtools -s project2 start --port 8098

# Multiple PTY sessions within one daemon (--sid)
tui-devtools -s test run "app1" --sid app1
tui-devtools -s test run "app2" --sid app2
tui-devtools -s test screenshot --sid app1
```

## Output Formats

```bash
tui-devtools screenshot                # Text (human-readable)
tui-devtools screenshot --json         # JSON (automation)
tui-devtools tree --json               # JSON component tree
tui-devtools sessions --json           # JSON session list
```

## How It Works

```
┌─────────────────────────────────────────────────────┐
│ tui-devtools daemon                                 │
│                                                     │
│  ┌──────────────┐    ┌───────────────────────────┐  │
│  │ PTY Manager  │    │ React DevTools Server     │  │
│  │ (node-pty +  │    │ (WebSocket :8097)         │  │
│  │  xterm)      │    │                           │  │
│  │              │    │ Ink app ──ws──► fiber tree │  │
│  │ Any TUI app  │    │              ► console    │  │
│  └──────┬───────┘    └───────────┬───────────────┘  │
│         │                        │                  │
│         └────────┬───────────────┘                  │
│                  │ Unix socket IPC                  │
└──────────────────┼──────────────────────────────────┘
                   │
            CLI commands ◄── AI agent / human
```

## Requirements

- Node.js >= 18
- macOS or Linux (PTY support)

**For React DevTools features (optional):**
- Target app must use Ink (React-based TUI)
- `react-devtools-core` package installed in the app
- App launched with `DEV=true` environment variable

## Troubleshooting

```bash
# posix_spawnp failed (macOS)
chmod +x $(npm root -g)/tui-devtools/node_modules/node-pty/prebuilds/darwin-*/spawn-helper

# Daemon status
tui-devtools -s test status

# Debug logs
cat ~/.tui-devtools/test.log
```

## License

MIT
