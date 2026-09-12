import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './vitest.setup.ts',
    // App tests run against the in-browser mock; api.test.ts imports runLiveAgents directly.
    env: { VITE_USE_MOCK: 'true' },
  },
});
