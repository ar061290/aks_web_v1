import { defineConfig } from 'vite';

// Relative base so the build works both at a domain root and under /aks_web_v1/ on GitHub Pages.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          motion: ['gsap', 'lenis'],
          katex: ['katex'],
        },
      },
    },
  },
  server: { host: true },
});
