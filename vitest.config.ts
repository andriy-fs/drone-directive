import { defineConfig } from 'vitest/config';

// Engine tests are pure (no DOM/React), so the fast Node environment is enough.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
