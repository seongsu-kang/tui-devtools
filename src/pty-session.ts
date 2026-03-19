/**
 * pty-session.ts — PTY session manager with headless terminal emulator
 *
 * Spawns processes in a pseudo-terminal, maintains a virtual screen buffer
 * via xterm-headless, and provides screenshot/input capabilities.
 */

import * as pty from 'node-pty';
import xtermPkg from '@xterm/headless';
const { Terminal } = xtermPkg;
import unicode11Pkg from '@xterm/addon-unicode11';
const { Unicode11Addon } = unicode11Pkg;

export interface PtySessionOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}

export interface PtySessionInfo {
  id: string;
  command: string;
  pid: number;
  cols: number;
  rows: number;
  running: boolean;
}

export class PtySession {
  readonly id: string;
  readonly command: string;
  private ptyProcess: pty.IPty;
  private terminal: InstanceType<typeof Terminal>;
  private _running = true;
  private exitCode: number | null = null;
  readonly cols: number;
  readonly rows: number;

  constructor(id: string, options: PtySessionOptions) {
    this.id = id;
    this.command = options.command;
    this.cols = options.cols ?? 120;
    this.rows = options.rows ?? 40;

    // Create headless terminal emulator
    this.terminal = new Terminal({
      cols: this.cols,
      rows: this.rows,
      allowProposedApi: true,
    });
    const unicode11 = new Unicode11Addon();
    this.terminal.loadAddon(unicode11);
    this.terminal.unicode.activeVersion = '11';

    // Merge environment
    const env = { ...process.env, ...options.env } as Record<string, string>;
    // Ensure TERM is set for proper PTY behavior
    if (!env.TERM) env.TERM = 'xterm-256color';
    // Force color support
    if (!env.FORCE_COLOR) env.FORCE_COLOR = '1';
    // Set COLUMNS/LINES for apps that check them
    env.COLUMNS = String(this.cols);
    env.LINES = String(this.rows);

    // Always run through shell for PATH resolution and command parsing
    const shell = process.env.SHELL || '/bin/bash';
    const shellArgs = ['-c', options.command];

    // Spawn PTY process via shell
    this.ptyProcess = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: this.cols,
      rows: this.rows,
      cwd: options.cwd ?? process.cwd(),
      env,
    });

    // Pipe PTY output to headless terminal
    this.ptyProcess.onData((data) => {
      this.terminal.write(data);
    });

    this.ptyProcess.onExit(({ exitCode }) => {
      this._running = false;
      this.exitCode = exitCode;
    });
  }

  /** Simple shell-like string splitting (handles quotes) */
  private shellSplit(cmd: string): string[] {
    const parts: string[] = [];
    let current = '';
    let inSingle = false;
    let inDouble = false;

    for (const ch of cmd) {
      if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
      if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
      if (ch === ' ' && !inSingle && !inDouble) {
        if (current) parts.push(current);
        current = '';
        continue;
      }
      current += ch;
    }
    if (current) parts.push(current);
    return parts;
  }

  get pid(): number {
    return this.ptyProcess.pid;
  }

  get running(): boolean {
    return this._running;
  }

  get info(): PtySessionInfo {
    return {
      id: this.id,
      command: this.command,
      pid: this.ptyProcess.pid,
      cols: this.cols,
      rows: this.rows,
      running: this._running,
    };
  }

  /** Capture current screen content as text */
  screenshot(options?: { stripAnsi?: boolean; includeCursor?: boolean }): string {
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];

    for (let i = 0; i < this.rows; i++) {
      const line = buffer.getLine(i);
      if (line) {
        lines.push(line.translateToString(true));
      }
    }

    // Trim trailing empty lines
    while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') {
      lines.pop();
    }

    let text = lines.join('\n');

    if (options?.stripAnsi) {
      text = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    }

    return text;
  }

  /** Send key press to the PTY */
  press(key: string): void {
    const seq = this.keyToSequence(key);
    this.ptyProcess.write(seq);
  }

  /** Type text character by character */
  type(text: string): void {
    this.ptyProcess.write(text);
  }

  /** Scroll the terminal viewport */
  scroll(direction: 'up' | 'down', amount = 1): void {
    for (let i = 0; i < amount; i++) {
      if (direction === 'up') {
        this.ptyProcess.write('\x1b[5~'); // Page Up
      } else {
        this.ptyProcess.write('\x1b[6~'); // Page Down
      }
    }
  }

  /** Resize the terminal */
  resize(cols: number, rows: number): void {
    this.ptyProcess.resize(cols, rows);
    this.terminal.resize(cols, rows);
  }

  /** Wait for text to appear on screen */
  async wait(text: string, timeoutMs = 30000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const screen = this.screenshot();
      if (screen.includes(text)) return true;
      await new Promise(r => setTimeout(r, 200));
    }
    return false;
  }

  /** Kill the PTY process */
  kill(signal: string = 'SIGTERM'): void {
    try {
      this.ptyProcess.kill(signal);
    } catch {
      // already dead
    }
    this._running = false;
  }

  /** Clean up resources */
  dispose(): void {
    this.kill();
    this.terminal.dispose();
  }

  /** Convert key name to terminal escape sequence */
  private keyToSequence(key: string): string {
    const keyMap: Record<string, string> = {
      'Enter': '\r',
      'Return': '\r',
      'Tab': '\t',
      'Escape': '\x1b',
      'Backspace': '\x7f',
      'Delete': '\x1b[3~',
      'Space': ' ',
      'ArrowUp': '\x1b[A',
      'ArrowDown': '\x1b[B',
      'ArrowRight': '\x1b[C',
      'ArrowLeft': '\x1b[D',
      'Home': '\x1b[H',
      'End': '\x1b[F',
      'PageUp': '\x1b[5~',
      'PageDown': '\x1b[6~',
      'Insert': '\x1b[2~',
      'F1': '\x1bOP',
      'F2': '\x1bOQ',
      'F3': '\x1bOR',
      'F4': '\x1bOS',
      'F5': '\x1b[15~',
      'F6': '\x1b[17~',
      'F7': '\x1b[18~',
      'F8': '\x1b[19~',
      'F9': '\x1b[20~',
      'F10': '\x1b[21~',
      'F11': '\x1b[23~',
      'F12': '\x1b[24~',
      'Ctrl-c': '\x03',
      'Ctrl-d': '\x04',
      'Ctrl-z': '\x1a',
      'Ctrl-l': '\x0c',
      'Ctrl-a': '\x01',
      'Ctrl-e': '\x05',
      'Ctrl-k': '\x0b',
      'Ctrl-u': '\x15',
    };

    return keyMap[key] ?? key;
  }
}
