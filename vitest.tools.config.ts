import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tools/**/*.test.ts'], testTimeout: 2400000 } });
