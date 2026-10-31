import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: { output: { manualChunks: { maplibre: ['maplibre-gl'] } } },
  },
});
