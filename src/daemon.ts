/**
 * daemon.ts — Background daemon with IPC server
 *
 * Manages the DevTools WebSocket server as a long-running process.
 * CLI commands communicate with the daemon via Unix socket IPC.
 */

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { DevToolsServer } from './server.js';
import { SessionManager } from './session-manager.js';
import type { IpcRequest, IpcResponse, LogEntry } from './types.js';

const BASE_DIR = path.join(process.env.HOME ?? '/tmp', '.tui-devtools');

function ensureBaseDir(): void {
  fs.mkdirSync(BASE_DIR, { recursive: true });
}

export function getSocketPath(session: string): string {
  return path.join(BASE_DIR, `${session}.sock`);
}

export function getPidPath(session: string): string {
  return path.join(BASE_DIR, `${session}.pid`);
}

export function getLogPath(session: string): string {
  return path.join(BASE_DIR, `${session}.log`);
}

/** Check if daemon is already running for a session */
export function isDaemonRunning(session: string): boolean {
  const pidPath = getPidPath(session);
  try {
    const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
    process.kill(pid, 0); // Check if process exists
    return true;
  } catch {
    return false;
  }
}

/** Send IPC request to running daemon */
export function sendIpcRequest(session: string, request: IpcRequest): Promise<IpcResponse> {
  return new Promise((resolve, reject) => {
    const socketPath = getSocketPath(session);
    const client = net.createConnection(socketPath);
    let buffer = '';

    client.on('connect', () => {
      client.write(JSON.stringify(request) + '\n');
    });

    client.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      if (lines.length > 1) {
        try {
          const response = JSON.parse(lines[0]!) as IpcResponse;
          client.end();
          resolve(response);
        } catch (e) {
          reject(new Error(`Invalid IPC response: ${lines[0]}`));
        }
      }
    });

    client.on('error', (err) => {
      reject(new Error(`Cannot connect to daemon (session: ${session}): ${err.message}`));
    });

    setTimeout(() => {
      client.destroy();
      reject(new Error('IPC timeout'));
    }, 10000);
  });
}

/** Start the daemon process (runs in foreground — caller should fork) */
export async function startDaemon(session: string, port: number): Promise<void> {
  ensureBaseDir();

  // Clean up stale socket
  const socketPath = getSocketPath(session);
  try { fs.unlinkSync(socketPath); } catch {}

  // Write PID
  fs.writeFileSync(getPidPath(session), String(process.pid));

  // Log file
  const logStream = fs.createWriteStream(getLogPath(session), { flags: 'a' });
  const log = (msg: string) => {
    const ts = new Date().toISOString();
    logStream.write(`[${ts}] ${msg}\n`);
  };

  // Session manager for PTY sessions
  const sessionMgr = new SessionManager();

  // Start DevTools server
  const devtools = new DevToolsServer({
    port,
    onLog: (entry: LogEntry) => {
      log(`[${entry.level}] ${entry.args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`);
    },
    onConnect: () => log('App connected'),
    onDisconnect: () => log('App disconnected'),
    debugLog: (msg: string) => log(msg),
  });

  await devtools.start();
  log(`DevTools server listening on port ${port}`);

  // Start IPC server
  const ipcServer = net.createServer((conn) => {
    let buffer = '';
    conn.on('data', async (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      if (lines.length <= 1) return;
      buffer = lines.slice(1).join('\n');

      try {
        const req = JSON.parse(lines[0]!) as IpcRequest;
        const res = await handleIpcRequest(req, devtools, sessionMgr, log);
        conn.write(JSON.stringify(res) + '\n');
      } catch (e) {
        conn.write(JSON.stringify({ ok: false, error: String(e) }) + '\n');
      }
    });
  });

  ipcServer.listen(socketPath);
  log(`IPC server listening on ${socketPath}`);

  // Graceful shutdown
  const cleanup = () => {
    log('Shutting down...');
    sessionMgr.killAll();
    devtools.stop();
    ipcServer.close();
    try { fs.unlinkSync(socketPath); } catch {}
    try { fs.unlinkSync(getPidPath(session)); } catch {}
    logStream.end();
    process.exit(0);
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}

async function handleIpcRequest(
  req: IpcRequest,
  devtools: DevToolsServer,
  sessionMgr: SessionManager,
  log: (msg: string) => void,
): Promise<IpcResponse> {
  const store = devtools.getStore();
  const bridge = devtools.getBridge();

  switch (req.command) {
    // ─── DevTools commands ───
    case 'status':
      return {
        ok: true,
        data: {
          connected: store.connected,
          appName: store.appName,
          nodeCount: store.nodes.size,
          rootCount: store.roots.size,
          logCount: store.logs.length,
          rendererIds: store.rendererIds,
          sessions: sessionMgr.list(),
        },
      };

    case 'tree': {
      const depth = (req.args?.depth as number) ?? 20;
      const json = req.args?.json as boolean;
      if (json) {
        return { ok: true, data: store.getTreeJson(undefined, depth) };
      }
      return { ok: true, data: store.getTree(undefined, depth) };
    }

    case 'inspect': {
      const name = req.args?.name as string | undefined;
      const id = req.args?.id as number | undefined;

      let node = id != null ? store.nodes.get(id) : null;
      if (!node && name) {
        node = store.findByName(name);
      }

      if (!node) {
        return { ok: false, error: `Component not found: ${name ?? id}` };
      }

      const inspectData = await bridge.inspectElement(node.id);

      return {
        ok: true,
        data: {
          id: node.id,
          displayName: node.displayName,
          type: node.type,
          key: node.key,
          parentId: node.parentId,
          childIds: node.childIds,
          props: node.props,
          state: node.state,
          inspectData,
        },
      };
    }

    case 'logs': {
      const level = req.args?.level as string | undefined;
      const tail = (req.args?.tail as number) ?? 50;

      let logs = store.logs;
      if (level) {
        logs = logs.filter(l => l.level === level);
      }
      logs = logs.slice(-tail);

      return { ok: true, data: logs };
    }

    case 'find': {
      const name = req.args?.name as string;
      if (!name) return { ok: false, error: 'name is required' };
      const nodes = store.findAllByName(name);
      return {
        ok: true,
        data: nodes.map(n => ({
          id: n.id,
          displayName: n.displayName,
          type: n.type,
          key: n.key,
        })),
      };
    }

    // ─── PTY automation commands ───
    case 'run': {
      const command = req.args?.command as string;
      const sessionId = req.args?.sessionId as string ?? 'default';
      const cwd = req.args?.cwd as string | undefined;
      const cols = req.args?.cols as number | undefined;
      const rows = req.args?.rows as number | undefined;
      const env = req.args?.env as Record<string, string> | undefined;

      if (!command) return { ok: false, error: 'command is required' };

      log(`[PTY] run session=${sessionId} command=${command}`);
      const info = sessionMgr.create(sessionId, { command, cwd, cols, rows, env });
      return { ok: true, data: info };
    }

    case 'screenshot': {
      const sessionId = req.args?.sessionId as string ?? 'default';
      const stripAnsi = req.args?.stripAnsi as boolean;
      const session = sessionMgr.get(sessionId);
      if (!session) return { ok: false, error: `Session not found: ${sessionId}` };

      const text = session.screenshot({ stripAnsi });
      return { ok: true, data: { screenshot: text, running: session.running } };
    }

    case 'press': {
      const sessionId = req.args?.sessionId as string ?? 'default';
      const keys = req.args?.keys as string[];
      const session = sessionMgr.get(sessionId);
      if (!session) return { ok: false, error: `Session not found: ${sessionId}` };

      for (const key of (keys ?? [])) {
        session.press(key);
      }
      return { ok: true };
    }

    case 'type': {
      const sessionId = req.args?.sessionId as string ?? 'default';
      const text = req.args?.text as string;
      const session = sessionMgr.get(sessionId);
      if (!session) return { ok: false, error: `Session not found: ${sessionId}` };
      if (!text) return { ok: false, error: 'text is required' };

      session.type(text);
      return { ok: true };
    }

    case 'scroll': {
      const sessionId = req.args?.sessionId as string ?? 'default';
      const direction = (req.args?.direction as string) ?? 'down';
      const amount = (req.args?.amount as number) ?? 1;
      const session = sessionMgr.get(sessionId);
      if (!session) return { ok: false, error: `Session not found: ${sessionId}` };

      session.scroll(direction as 'up' | 'down', amount);
      return { ok: true };
    }

    case 'wait': {
      const sessionId = req.args?.sessionId as string ?? 'default';
      const text = req.args?.text as string;
      const timeout = (req.args?.timeout as number) ?? 30000;
      const session = sessionMgr.get(sessionId);
      if (!session) return { ok: false, error: `Session not found: ${sessionId}` };
      if (!text) return { ok: false, error: 'text is required' };

      const found = await session.wait(text, timeout);
      return { ok: true, data: { found, screenshot: session.screenshot() } };
    }

    case 'resize': {
      const sessionId = req.args?.sessionId as string ?? 'default';
      const cols = req.args?.cols as number ?? 120;
      const rows = req.args?.rows as number ?? 40;
      const session = sessionMgr.get(sessionId);
      if (!session) return { ok: false, error: `Session not found: ${sessionId}` };

      session.resize(cols, rows);
      return { ok: true };
    }

    case 'kill-session': {
      const sessionId = req.args?.sessionId as string ?? 'default';
      const killed = sessionMgr.kill(sessionId);
      return { ok: killed, error: killed ? undefined : `Session not found: ${sessionId}` };
    }

    case 'sessions':
      return { ok: true, data: sessionMgr.list() };

    default:
      return { ok: false, error: `Unknown command: ${req.command}` };
  }
}
