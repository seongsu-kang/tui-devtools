export interface FiberNode {
  id: number;
  displayName: string | null;
  type: 'function' | 'class' | 'host' | 'other';
  parentId: number | null;
  childIds: number[];
  key: string | null;
  // Populated on-demand via inspectElement
  props?: Record<string, unknown>;
  state?: Record<string, unknown>;
  hooks?: HookInfo[];
}

export interface HookInfo {
  id: number | null;
  name: string;
  value: unknown;
  subHooks?: HookInfo[];
}

export interface LogEntry {
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  args: unknown[];
  timestamp: number;
  componentStack?: string;
}

export interface IpcRequest {
  command: string;
  args?: Record<string, unknown>;
}

export interface IpcResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
}

// React DevTools protocol constants
// See: https://github.com/facebook/react/blob/main/packages/react-devtools-shared/src/constants.js
export const TREE_OPERATION_ADD = 1;
export const TREE_OPERATION_REMOVE = 2;
export const TREE_OPERATION_REORDER_CHILDREN = 3;
export const TREE_OPERATION_UPDATE_TREE_BASE_DURATION = 4;
export const TREE_OPERATION_UPDATE_ERRORS_OR_WARNINGS = 5;
export const TREE_OPERATION_REMOVE_ROOT = 6;
export const TREE_OPERATION_SET_SUBTREE_MODE = 7;

export const ElementTypeClass = 1;
export const ElementTypeFunction = 2;
export const ElementTypeContext = 3;
export const ElementTypeForwardRef = 4;
export const ElementTypeHostComponent = 5;
export const ElementTypeMemo = 6;
export const ElementTypeOtherOrUnknown = 7;
export const ElementTypeProfiler = 8;
export const ElementTypeRoot = 9;
export const ElementTypeSuspense = 10;
export const ElementTypeSuspenseList = 11;
export const ElementTypeTracingMarker = 12;
