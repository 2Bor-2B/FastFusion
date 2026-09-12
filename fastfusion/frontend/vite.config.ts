import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { sites } from '@openai/sites-vite-plugin';

export default defineConfig({
  plugins: [react(), tailwindcss(), sites()],
  server: {
    proxy: {
      // Forward /api/* to the FastAPI backend during development.
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
});
