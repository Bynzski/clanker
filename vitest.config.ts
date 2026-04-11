import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer'),
    },
  },
  test: {
    // Keep the root config as shared coverage/setup only.
    // File discovery is project-scoped so the runtime environment is obvious:
    // - tests/main/** -> node
    // - tests/renderer/** -> jsdom
    projects: [
      {
        extends: true,
        test: {
          name: 'main',
          include: ['tests/main/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['./tests/setup/vitest.setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'renderer',
          include: ['tests/renderer/**/*.test.ts', 'tests/renderer/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['./tests/setup/vitest.setup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.d.ts', 'src/renderer/vite-env.d.ts'],
    },
  },
});
