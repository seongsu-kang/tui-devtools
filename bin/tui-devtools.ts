/**
 * tui-devtools CLI — DevTools for Ink TUI apps
 *
 * Usage:
 *   tui-devtools start              Start DevTools server daemon
 *   tui-devtools status             Show connection status
 *   tui-devtools tree               Print component tree
 *   tui-devtools inspect <name>     Inspect a component's props/state
 *   tui-devtools logs               Show captured console logs
 *   tui-devtools stop               Stop daemon
 */

import { program } from 'commander';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import {
  sendIpcRequest,
  isDaemonRunning,
  getPidPath,
  getLogPath,
  getSocketPath,
} from '../src/daemon.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_PORT = 8097;
const DEFAULT_SESSION = 'default';

program
  .name('tui-devtools')
  .description('DevTools for Ink TUI apps — component tree, state inspection, console capture')
  .version('0.1.0')
  .option('-s, --session <name>', 'Session name for daemon isolation', DEFAULT_SESSION)
  .option('-p, --port <port>', 'DevTools server port', String(DEFAULT_PORT))
  .option('--json', 'JSON output');

// ─── start ───
program
  .command('start')
  .description('Start the DevTools server daemon')
  .action(async () => {
    const opts = program.opts();
    const session = opts.session as string;
    const port = parseInt(opts.port as string, 10);

    if (isDaemonRunning(session)) {
      console.log(`Daemon already running (session: ${session})`);
      return;
    }

    // Fork daemon process
    const child = fork(__filename, ['__daemon__', session, String(port)], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    // Wait for socket to appear
    const socketPath = getSocketPath(session);
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 200));
      if (fs.existsSync(socketPath)) {
        console.log(`DevTools server started (session: ${session}, port: ${port})`);
        console.log(`  Logs: ${getLogPath(session)}`);
        console.log(`\nStart your Ink app with: DEV=true your-app`);
        return;
      }
    }
    console.error('Failed to start daemon — check logs:', getLogPath(session));
    process.exit(1);
  });

// ─── stop ───
program
  .command('stop')
  .description('Stop the daemon')
  .action(async () => {
    const session = program.opts().session as string;
    const pidPath = getPidPath(session);

    try {
      const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
      process.kill(pid, 'SIGTERM');
      console.log(`Daemon stopped (session: ${session})`);
    } catch {
      console.log(`No daemon running (session: ${session})`);
    }
  });

// ─── status ───
program
  .command('status')
  .description('Show connection status')
  .action(async () => {
    const opts = program.opts();
    const session = opts.session as string;
    const json = opts.json as boolean;

    if (!isDaemonRunning(session)) {
      if (json) {
        console.log(JSON.stringify({ running: false }));
      } else {
        console.log(`Daemon not running (session: ${session})`);
      }
      return;
    }

    try {
      const res = await sendIpcRequest(session, { command: 'status' });
      if (json) {
        console.log(JSON.stringify(res.data));
      } else {
        const d = res.data as Record<string, unknown>;
        console.log(`Session:    ${session}`);
        console.log(`Connected:  ${d.connected ? 'yes' : 'no'}`);
        console.log(`Components: ${d.nodeCount}`);
        console.log(`Roots:      ${d.rootCount}`);
        console.log(`Logs:       ${d.logCount}`);
      }
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`);
    }
  });

// ─── tree ───
program
  .command('tree')
  .description('Print component tree')
  .option('-d, --depth <n>', 'Max tree depth', '20')
  .action(async (cmdOpts) => {
    const opts = program.opts();
    const session = opts.session as string;
    const json = opts.json as boolean;
    const depth = parseInt(cmdOpts.depth, 10);

    if (!isDaemonRunning(session)) {
      console.error('Daemon not running. Start with: tui-devtools start');
      process.exit(1);
    }

    try {
      const res = await sendIpcRequest(session, {
        command: 'tree',
        args: { depth, json },
      });
      if (res.ok) {
        if (json) {
          console.log(JSON.stringify(res.data, null, 2));
        } else {
          console.log(res.data || '(empty tree — is the app connected?)');
        }
      } else {
        console.error(`Error: ${res.error}`);
      }
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`);
    }
  });

// ─── inspect ───
program
  .command('inspect [component]')
  .description('Inspect a component\'s props, state, and hooks')
  .option('--id <id>', 'Inspect by fiber ID')
  .action(async (component, cmdOpts) => {
    const opts = program.opts();
    const session = opts.session as string;
    const json = opts.json as boolean;
    const id = cmdOpts.id ? parseInt(cmdOpts.id, 10) : undefined;

    if (!component && id == null) {
      console.error('Usage: tui-devtools inspect <component-name> or --id <id>');
      process.exit(1);
    }

    if (!isDaemonRunning(session)) {
      console.error('Daemon not running. Start with: tui-devtools start');
      process.exit(1);
    }

    try {
      const res = await sendIpcRequest(session, {
        command: 'inspect',
        args: { name: component, id },
      });
      if (res.ok) {
        if (json) {
          console.log(JSON.stringify(res.data, null, 2));
        } else {
          const d = res.data as Record<string, unknown>;
          console.log(`Component: ${d.displayName} [${d.id}]`);
          console.log(`Type:      ${d.type}`);
          if (d.key) console.log(`Key:       ${d.key}`);
          console.log(`Parent:    ${d.parentId}`);
          console.log(`Children:  ${(d.childIds as number[])?.length ?? 0}`);
          if (d.props) {
            console.log(`\nProps:`);
            console.log(JSON.stringify(d.props, null, 2));
          }
          if (d.state) {
            console.log(`\nState:`);
            console.log(JSON.stringify(d.state, null, 2));
          }
          if (d.inspectData) {
            console.log(`\nInspect Data:`);
            console.log(JSON.stringify(d.inspectData, null, 2));
          }
        }
      } else {
        console.error(`Error: ${res.error}`);
      }
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`);
    }
  });

// ─── find ───
program
  .command('find <name>')
  .description('Find components by name')
  .action(async (name) => {
    const opts = program.opts();
    const session = opts.session as string;
    const json = opts.json as boolean;

    if (!isDaemonRunning(session)) {
      console.error('Daemon not running. Start with: tui-devtools start');
      process.exit(1);
    }

    try {
      const res = await sendIpcRequest(session, {
        command: 'find',
        args: { name },
      });
      if (res.ok) {
        const nodes = res.data as Array<{ id: number; displayName: string; type: string; key: string | null }>;
        if (json) {
          console.log(JSON.stringify(nodes, null, 2));
        } else if (nodes.length === 0) {
          console.log(`No components matching "${name}"`);
        } else {
          for (const n of nodes) {
            console.log(`  [${n.id}] ${n.displayName} (${n.type})${n.key ? ` key="${n.key}"` : ''}`);
          }
        }
      } else {
        console.error(`Error: ${res.error}`);
      }
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`);
    }
  });

// ─── logs ───
program
  .command('logs')
  .description('Show captured console logs')
  .option('-l, --level <level>', 'Filter by level (log|warn|error|info|debug)')
  .option('-t, --tail <n>', 'Show last N entries', '50')
  .action(async (cmdOpts) => {
    const opts = program.opts();
    const session = opts.session as string;
    const json = opts.json as boolean;

    if (!isDaemonRunning(session)) {
      console.error('Daemon not running. Start with: tui-devtools start');
      process.exit(1);
    }

    try {
      const res = await sendIpcRequest(session, {
        command: 'logs',
        args: {
          level: cmdOpts.level,
          tail: parseInt(cmdOpts.tail, 10),
        },
      });
      if (res.ok) {
        const logs = res.data as Array<{ level: string; args: unknown[]; timestamp: number }>;
        if (json) {
          console.log(JSON.stringify(logs, null, 2));
        } else if (logs.length === 0) {
          console.log('(no logs captured)');
        } else {
          for (const entry of logs) {
            const ts = new Date(entry.timestamp).toISOString().slice(11, 19);
            const level = entry.level.toUpperCase().padEnd(5);
            const msg = entry.args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
            console.log(`${ts} [${level}] ${msg}`);
          }
        }
      } else {
        console.error(`Error: ${res.error}`);
      }
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`);
    }
  });

// ═══════════════════════════════════════════
// PTY Automation Commands (replaces agent-tui)
// ═══════════════════════════════════════════

function ensureDaemon(session: string): void {
  if (!isDaemonRunning(session)) {
    console.error('Daemon not running. Start with: tui-devtools start');
    process.exit(1);
  }
}

// ─── run ───
program
  .command('run <command...>')
  .description('Run a TUI application in a virtual terminal')
  .option('-d, --cwd <dir>', 'Working directory')
  .option('--cols <n>', 'Terminal columns', '120')
  .option('--rows <n>', 'Terminal rows', '40')
  .option('--sid <id>', 'PTY session ID', 'default')
  .action(async (commandParts: string[], cmdOpts) => {
    const opts = program.opts();
    const session = opts.session as string;
    const json = opts.json as boolean;
    const command = commandParts.join(' ');

    ensureDaemon(session);

    try {
      const res = await sendIpcRequest(session, {
        command: 'run',
        args: {
          command,
          sessionId: cmdOpts.sid,
          cwd: cmdOpts.cwd,
          cols: parseInt(cmdOpts.cols, 10),
          rows: parseInt(cmdOpts.rows, 10),
        },
      });
      if (res.ok) {
        const info = res.data as { id: string; pid: number; cols: number; rows: number };
        if (json) {
          console.log(JSON.stringify(info));
        } else {
          console.log(`Session started: ${info.id}`);
          console.log(`  PID: ${info.pid}`);
        }
      } else {
        console.error(`Error: ${res.error}`);
        process.exit(1);
      }
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`);
      process.exit(1);
    }
  });

// ─── screenshot ───
program
  .command('screenshot')
  .description('Capture current terminal screen')
  .option('--sid <id>', 'PTY session ID', 'default')
  .option('--strip-ansi', 'Strip ANSI color codes')
  .action(async (cmdOpts) => {
    const opts = program.opts();
    const session = opts.session as string;
    const json = opts.json as boolean;

    ensureDaemon(session);

    try {
      const res = await sendIpcRequest(session, {
        command: 'screenshot',
        args: { sessionId: cmdOpts.sid, stripAnsi: cmdOpts.stripAnsi },
      });
      if (res.ok) {
        const data = res.data as { screenshot: string; running: boolean };
        if (json) {
          console.log(JSON.stringify(data));
        } else {
          console.log(`Screenshot:${data.running ? '' : ' [stopped]'}`);
          console.log(data.screenshot);
        }
      } else {
        console.error(`Error: ${res.error}`);
      }
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`);
    }
  });

// ─── press ───
program
  .command('press <keys...>')
  .description('Send key press(es) to the terminal')
  .option('--sid <id>', 'PTY session ID', 'default')
  .action(async (keys: string[], cmdOpts) => {
    const opts = program.opts();
    const session = opts.session as string;

    ensureDaemon(session);

    try {
      const res = await sendIpcRequest(session, {
        command: 'press',
        args: { sessionId: cmdOpts.sid, keys },
      });
      if (res.ok) {
        console.log('✓ Key pressed');
      } else {
        console.error(`Error: ${res.error}`);
      }
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`);
    }
  });

// ─── type ───
program
  .command('type <text>')
  .description('Type text into the terminal')
  .option('--sid <id>', 'PTY session ID', 'default')
  .action(async (text: string, cmdOpts) => {
    const opts = program.opts();
    const session = opts.session as string;

    ensureDaemon(session);

    try {
      const res = await sendIpcRequest(session, {
        command: 'type',
        args: { sessionId: cmdOpts.sid, text },
      });
      if (res.ok) {
        console.log('✓ Text typed');
      } else {
        console.error(`Error: ${res.error}`);
      }
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`);
    }
  });

// ─── wait ───
program
  .command('wait <text>')
  .description('Wait for text to appear on screen')
  .option('--sid <id>', 'PTY session ID', 'default')
  .option('--timeout <ms>', 'Timeout in milliseconds', '30000')
  .action(async (text: string, cmdOpts) => {
    const opts = program.opts();
    const session = opts.session as string;
    const json = opts.json as boolean;

    ensureDaemon(session);

    try {
      const res = await sendIpcRequest(session, {
        command: 'wait',
        args: { sessionId: cmdOpts.sid, text, timeout: parseInt(cmdOpts.timeout, 10) },
      });
      if (res.ok) {
        const data = res.data as { found: boolean; screenshot: string };
        if (json) {
          console.log(JSON.stringify(data));
        } else {
          console.log(data.found ? `✓ Found: "${text}"` : `✗ Timeout waiting for: "${text}"`);
        }
      } else {
        console.error(`Error: ${res.error}`);
      }
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`);
    }
  });

// ─── kill (PTY session) ───
program
  .command('kill-session')
  .description('Kill a PTY session')
  .option('--sid <id>', 'PTY session ID', 'default')
  .action(async (cmdOpts) => {
    const opts = program.opts();
    const session = opts.session as string;

    ensureDaemon(session);

    try {
      const res = await sendIpcRequest(session, {
        command: 'kill-session',
        args: { sessionId: cmdOpts.sid },
      });
      if (res.ok) {
        console.log(`Session killed: ${cmdOpts.sid}`);
      } else {
        console.error(`Error: ${res.error}`);
      }
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`);
    }
  });

// ─── sessions (list PTY sessions) ───
program
  .command('sessions')
  .description('List PTY sessions')
  .action(async () => {
    const opts = program.opts();
    const session = opts.session as string;
    const json = opts.json as boolean;

    ensureDaemon(session);

    try {
      const res = await sendIpcRequest(session, { command: 'sessions' });
      if (res.ok) {
        const sessions = res.data as Array<{ id: string; command: string; pid: number; running: boolean; cols: number; rows: number }>;
        if (json) {
          console.log(JSON.stringify(sessions, null, 2));
        } else if (sessions.length === 0) {
          console.log('No active PTY sessions');
        } else {
          for (const s of sessions) {
            console.log(`  ${s.id} — ${s.command} [${s.running ? 'running' : 'stopped'}] ${s.cols}x${s.rows} pid:${s.pid}`);
          }
        }
      } else {
        console.error(`Error: ${res.error}`);
      }
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`);
    }
  });

// ─── Internal: daemon entry point ───
if (process.argv[2] === '__daemon__') {
  const session = process.argv[3] ?? DEFAULT_SESSION;
  const port = parseInt(process.argv[4] ?? String(DEFAULT_PORT), 10);

  const { startDaemon } = await import('../src/daemon.js');
  await startDaemon(session, port);
} else {
  program.parse();
}
