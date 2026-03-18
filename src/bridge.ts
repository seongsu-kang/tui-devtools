/**
 * bridge.ts — Parses React DevTools protocol messages
 *
 * The DevTools protocol uses a simple JSON-based message format over WebSocket:
 *   { event: string, payload: unknown }
 *
 * Key events:
 * - "operations": Fiber tree mutations (add/remove/reorder nodes)
 * - "inspectedElement": Response to element inspection requests
 * - "shutdown": App disconnecting
 *
 * Operations payload is an Int32Array with a compact binary format.
 * See: react-devtools-shared/src/devtools/store.js
 */

import type { WebSocket } from 'ws';
import { DevToolsStore } from './store.js';
import type { FiberNode, LogEntry } from './types.js';
import {
  TREE_OPERATION_ADD,
  TREE_OPERATION_REMOVE,
  TREE_OPERATION_REORDER_CHILDREN,
  TREE_OPERATION_UPDATE_TREE_BASE_DURATION,
  TREE_OPERATION_UPDATE_ERRORS_OR_WARNINGS,
  TREE_OPERATION_REMOVE_ROOT,
  TREE_OPERATION_SET_SUBTREE_MODE,
  ElementTypeClass,
  ElementTypeFunction,
  ElementTypeHostComponent,
  ElementTypeRoot,
} from './types.js';

export class DevToolsBridge {
  private ws: WebSocket | null = null;
  private store: DevToolsStore;
  private onLog?: (entry: LogEntry) => void;

  constructor(store: DevToolsStore, onLog?: (entry: LogEntry) => void) {
    this.store = store;
    this.onLog = onLog;
  }

  attach(ws: WebSocket): void {
    this.ws = ws;
    this.store.connected = true;

    ws.on('message', (data: Buffer | string) => {
      try {
        const msg = JSON.parse(typeof data === 'string' ? data : data.toString());
        this.handleMessage(msg);
      } catch {
        // ignore parse errors
      }
    });

    ws.on('close', () => {
      this.store.connected = false;
      this.ws = null;
    });
  }

  private handleMessage(msg: { event: string; payload?: unknown }): void {
    switch (msg.event) {
      case 'operations':
        this.handleOperations(msg.payload as number[]);
        break;

      case 'inspectedElement':
        this.handleInspectedElement(msg.payload);
        break;

      case 'shutdown':
        this.store.connected = false;
        break;

      // Console capture — DevTools patches console methods and sends logs
      case 'console-log':
      case 'console-warn':
      case 'console-error':
      case 'console-info':
      case 'console-debug': {
        const level = msg.event.replace('console-', '') as LogEntry['level'];
        const entry: LogEntry = {
          level,
          args: Array.isArray(msg.payload) ? msg.payload : [msg.payload],
          timestamp: Date.now(),
        };
        this.store.addLog(entry);
        this.onLog?.(entry);
        break;
      }

      // DevTools backend sends renderer info
      case 'renderer': {
        const payload = msg.payload as { id: number; rendererPackageName?: string } | undefined;
        if (payload?.id != null) {
          this.store.rendererIds.push(payload.id);
        }
        break;
      }

      case 'renderer-attached': {
        const payload = msg.payload as { id: number } | undefined;
        if (payload?.id != null && !this.store.rendererIds.includes(payload.id)) {
          this.store.rendererIds.push(payload.id);
        }
        break;
      }
    }
  }

  private handleOperations(ops: number[]): void {
    if (!ops || ops.length === 0) return;

    // Operations format: [rendererID, rootFiberID, ...operations]
    let i = 0;
    const rendererId = ops[i++]!;
    const rootId = ops[i++]!;

    // Ensure renderer is tracked
    if (!this.store.rendererIds.includes(rendererId)) {
      this.store.rendererIds.push(rendererId);
    }

    // Ensure root exists
    if (!this.store.nodes.has(rootId)) {
      this.store.addNode({
        id: rootId,
        displayName: 'Root',
        type: 'other',
        parentId: null,
        childIds: [],
        key: null,
      });
    }

    while (i < ops.length) {
      const op = ops[i]!;

      switch (op) {
        case TREE_OPERATION_ADD: {
          i++; // skip op
          const id = ops[i++]!;
          const elementType = ops[i++]!;
          const parentId = ops[i++]!;
          const ownerID = ops[i++]!; // skip owner
          void ownerID;
          const displayNameLength = ops[i++]!;

          // Read display name from subsequent slots (encoded as char codes)
          let displayName: string | null = null;
          if (displayNameLength > 0) {
            const chars: string[] = [];
            for (let j = 0; j < displayNameLength; j++) {
              chars.push(String.fromCharCode(ops[i++]!));
            }
            displayName = chars.join('');
          }

          const keyLength = ops[i++]!;
          let key: string | null = null;
          if (keyLength > 0) {
            const chars: string[] = [];
            for (let j = 0; j < keyLength; j++) {
              chars.push(String.fromCharCode(ops[i++]!));
            }
            key = chars.join('');
          }

          let type: FiberNode['type'] = 'other';
          if (elementType === ElementTypeFunction) type = 'function';
          else if (elementType === ElementTypeClass) type = 'class';
          else if (elementType === ElementTypeHostComponent) type = 'host';
          else if (elementType === ElementTypeRoot) type = 'other';

          const node: FiberNode = {
            id,
            displayName,
            type,
            parentId: parentId === 0 ? rootId : parentId,
            childIds: [],
            key,
          };

          this.store.addNode(node);

          // Add to parent's children
          const parent = this.store.nodes.get(node.parentId!);
          if (parent && !parent.childIds.includes(id)) {
            parent.childIds.push(id);
          }
          break;
        }

        case TREE_OPERATION_REMOVE: {
          i++; // skip op
          const removeCount = ops[i++]!;
          for (let j = 0; j < removeCount; j++) {
            const id = ops[i++]!;
            this.store.removeNode(id);
          }
          break;
        }

        case TREE_OPERATION_REORDER_CHILDREN: {
          i++; // skip op
          const id = ops[i++]!;
          const childCount = ops[i++]!;
          const newChildIds: number[] = [];
          for (let j = 0; j < childCount; j++) {
            newChildIds.push(ops[i++]!);
          }
          const node = this.store.nodes.get(id);
          if (node) node.childIds = newChildIds;
          break;
        }

        case TREE_OPERATION_UPDATE_TREE_BASE_DURATION: {
          i++; // skip op
          i++; // skip id
          i++; // skip duration
          break;
        }

        case TREE_OPERATION_UPDATE_ERRORS_OR_WARNINGS: {
          i++; // skip op
          i++; // skip id
          i++; // skip errors count
          i++; // skip warnings count
          break;
        }

        case TREE_OPERATION_REMOVE_ROOT: {
          i++; // skip op
          break;
        }

        case TREE_OPERATION_SET_SUBTREE_MODE: {
          i++; // skip op
          i++; // skip id
          i++; // skip mode
          break;
        }

        default:
          // Unknown operation — skip it
          i++;
          break;
      }
    }
  }

  private handleInspectedElement(payload: unknown): void {
    const p = payload as {
      id?: number;
      responseID?: number;
      type?: string;
      value?: {
        props?: Record<string, unknown>;
        state?: Record<string, unknown>;
        hooks?: unknown[];
      };
    };

    if (p?.responseID != null) {
      this.store.resolveInspectCallback(p.responseID, p.value);
    }

    // Also update node's cached data
    if (p?.id != null && p?.value) {
      const node = this.store.nodes.get(p.id);
      if (node) {
        if (p.value.props) node.props = p.value.props;
        if (p.value.state) node.state = p.value.state;
      }
    }
  }

  /** Request element inspection from the DevTools backend */
  inspectElement(id: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('Not connected'));
        return;
      }

      const requestId = this.store.registerInspectCallback(resolve);
      const rendererId = this.store.rendererIds[0] ?? 1;

      this.ws.send(JSON.stringify({
        event: 'inspectElement',
        payload: {
          id,
          rendererID: rendererId,
          requestID: requestId,
          forceFullData: true,
          path: null,
        },
      }));

      // Timeout after 5s
      setTimeout(() => {
        this.store.resolveInspectCallback(requestId, null);
      }, 5000);
    });
  }

  detach(): void {
    this.ws?.close();
    this.ws = null;
    this.store.connected = false;
  }
}
