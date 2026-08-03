import { defineConfig } from 'vitest/config';

// Nothing here touches a DOM: the transport is exercised through its codec and
// schemas, not through a real socket.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
