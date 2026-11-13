import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { renderApi } from './server/render';
import { filesApi } from './server/files';

export default defineConfig({
  plugins: [react(), renderApi(), filesApi()],
  server: {
    port: 5173,
    strictPort: true,
    // Exports, saved projects and uploaded images must not reload the page.
    watch: { ignored: ['**/out/**', '**/projects/**', '**/public/assets/**'] },
  },
});
