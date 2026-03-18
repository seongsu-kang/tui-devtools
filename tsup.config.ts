import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { 'bin/tui-devtools': 'bin/tui-devtools.ts' },
    format: ['esm'],
    target: 'node18',
    sourcemap: true,
    clean: true,
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    entry: { 'src/index': 'src/index.ts' },
    format: ['esm'],
    target: 'node18',
    dts: true,
    sourcemap: true,
  },
]);
