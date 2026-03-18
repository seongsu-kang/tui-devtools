/**
 * server.ts — WebSocket server for React DevTools connections
 *
 * Listens on a port (default 8097) and waits for Ink apps to connect.
 * When DEV=true, Ink's reconciler calls connectToDevTools() which
 * connects to this server as a WebSocket client.
 */

import { WebSocketServer, type WebSocket } from 'ws';
import { DevToolsStore } from './store.js';
import { DevToolsBridge } from './bridge.js';
import type { LogEntry } from './types.js';

export interface ServerOptions {
  port: number;
  host?: string;
  onLog?: (entry: LogEntry) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

export class DevToolsServer {
  private wss: WebSocketServer | null = null;
  private store: DevToolsStore;
  private bridge: DevToolsBridge;
  private options: ServerOptions;

  constructor(options: ServerOptions) {
    this.options = options;
    this.store = new DevToolsStore();
    this.bridge = new DevToolsBridge(this.store, options.onLog);
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const host = this.options.host ?? '127.0.0.1';
      this.wss = new WebSocketServer({ port: this.options.port, host });

      this.wss.on('listening', () => {
        resolve();
      });

      this.wss.on('error', (err) => {
        reject(err);
      });

      this.wss.on('connection', (ws: WebSocket) => {
        this.bridge.attach(ws);
        this.options.onConnect?.();

        ws.on('close', () => {
          this.options.onDisconnect?.();
        });
      });
    });
  }

  stop(): void {
    this.bridge.detach();
    this.wss?.close();
    this.wss = null;
  }

  getStore(): DevToolsStore {
    return this.store;
  }

  getBridge(): DevToolsBridge {
    return this.bridge;
  }

  isConnected(): boolean {
    return this.store.connected;
  }
}
