import type { FiberNode, LogEntry } from './types.js';

const MAX_LOGS = 500;

export class DevToolsStore {
  roots = new Map<number, FiberNode>();
  nodes = new Map<number, FiberNode>();
  logs: LogEntry[] = [];
  connected = false;
  appName: string | null = null;
  rendererIds: number[] = [];

  // Pending inspection responses keyed by request ID
  private inspectCallbacks = new Map<number, (data: unknown) => void>();
  private nextRequestId = 1;

  addNode(node: FiberNode): void {
    this.nodes.set(node.id, node);
    if (node.parentId === null || node.parentId === 0) {
      this.roots.set(node.id, node);
    }
  }

  removeNode(id: number): void {
    const node = this.nodes.get(id);
    if (node) {
      // Remove from parent's children
      if (node.parentId !== null) {
        const parent = this.nodes.get(node.parentId);
        if (parent) {
          parent.childIds = parent.childIds.filter(cid => cid !== id);
        }
      }
      // Remove children recursively
      for (const childId of node.childIds) {
        this.removeNode(childId);
      }
      this.nodes.delete(id);
      this.roots.delete(id);
    }
  }

  addLog(entry: LogEntry): void {
    this.logs.push(entry);
    if (this.logs.length > MAX_LOGS) {
      this.logs = this.logs.slice(-MAX_LOGS);
    }
  }

  findByName(name: string): FiberNode | null {
    for (const node of this.nodes.values()) {
      if (node.displayName === name) return node;
    }
    // Partial match
    for (const node of this.nodes.values()) {
      if (node.displayName?.includes(name)) return node;
    }
    return null;
  }

  findAllByName(name: string): FiberNode[] {
    const results: FiberNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.displayName?.includes(name)) results.push(node);
    }
    return results;
  }

  getTree(rootId?: number, maxDepth = 20): string {
    const lines: string[] = [];
    const roots = rootId ? [this.nodes.get(rootId)].filter(Boolean) as FiberNode[] : [...this.roots.values()];

    for (const root of roots) {
      this.printNode(root, 0, maxDepth, lines);
    }
    return lines.join('\n');
  }

  getTreeJson(rootId?: number, maxDepth = 20): object[] {
    const roots = rootId ? [this.nodes.get(rootId)].filter(Boolean) as FiberNode[] : [...this.roots.values()];
    return roots.map(r => this.nodeToJson(r, 0, maxDepth));
  }

  private printNode(node: FiberNode, depth: number, maxDepth: number, lines: string[]): void {
    if (depth > maxDepth) return;
    const indent = '  '.repeat(depth);
    const name = node.displayName || `<${node.type}>`;
    const keyStr = node.key ? ` key="${node.key}"` : '';
    lines.push(`${indent}${name}${keyStr} [${node.id}]`);
    for (const childId of node.childIds) {
      const child = this.nodes.get(childId);
      if (child) this.printNode(child, depth + 1, maxDepth, lines);
    }
  }

  private nodeToJson(node: FiberNode, depth: number, maxDepth: number): object {
    const children = depth < maxDepth
      ? node.childIds
          .map(id => this.nodes.get(id))
          .filter(Boolean)
          .map(child => this.nodeToJson(child!, depth + 1, maxDepth))
      : [];
    return {
      id: node.id,
      name: node.displayName,
      type: node.type,
      key: node.key,
      children,
    };
  }

  registerInspectCallback(callback: (data: unknown) => void): number {
    const id = this.nextRequestId++;
    this.inspectCallbacks.set(id, callback);
    return id;
  }

  resolveInspectCallback(requestId: number, data: unknown): void {
    const cb = this.inspectCallbacks.get(requestId);
    if (cb) {
      this.inspectCallbacks.delete(requestId);
      cb(data);
    }
  }

  clear(): void {
    this.roots.clear();
    this.nodes.clear();
    this.logs = [];
    this.connected = false;
    this.appName = null;
    this.rendererIds = [];
  }
}
