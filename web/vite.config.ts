import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** This file's own directory, so `npm run build` works from the repo root. */
const HERE = fileURLToPath(new URL('.', import.meta.url));

/**
 * Unit I — how the wall's one JS bundle is produced.
 *
 * ## `assetsDir: 'bundle'` is load-bearing, not taste
 *
 * Vite's default output directory is `assets/`, and `/assets/` is already spoken for: it is
 * the route in docs/api.md that turns a `Child.avatarAssetId` into image bytes, and
 * `web/src/views/logic/summary.ts` hardcodes `ASSET_ROOT = '/assets/'`. Leaving the default
 * would put hashed JS and children's avatars in the same namespace, where a collision is a
 * missing face on the wall or a 404'd bundle — and the second one is a blank screen. Renaming
 * ours is free; renaming a frozen route is not.
 *
 * ## Everything is inlined into two files, and that is the point
 *
 * The kiosk holds this bundle for months without a reload. Fewer, larger artefacts mean fewer
 * independent things that can 404 after a redeploy while the page is still live. There is no
 * code splitting and no lazy route: the whole wall is one screen.
 */
export default defineConfig({
  root: HERE,
  base: '/',
  plugins: [react()],

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // NOT 'assets' — see the note above.
    assetsDir: 'bundle',
    // Chromium 151 on the Pi. Targeting anything older only costs us transpiled output that
    // this one browser will never need.
    target: 'es2022',
    sourcemap: true,
    // A wall that is never reloaded gains nothing from splitting, and every extra chunk is
    // another request that can fail on its own.
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },

  server: {
    host: '127.0.0.1',
    port: 5173,
    fs: {
      // `web/src/**` imports the frozen contracts from `src/**`, one level above the Vite root.
      // The build resolves that fine; the dev server needs to be told it is allowed to.
      allow: ['..'],
    },
    proxy: {
      // `npm run dev` against a wall server started with `npm start`, so the bundle is
      // same-origin in development for exactly the reasons it is in production.
      '/api': { target: 'http://127.0.0.1:8124', changeOrigin: false },
      '/assets': { target: 'http://127.0.0.1:8124', changeOrigin: false },
      '/icons': { target: 'http://127.0.0.1:8124', changeOrigin: false },
    },
  },

  // The bundle must not carry a build-time secret, ever. The device token comes from the Pi at
  // runtime through the URL fragment (see web/src/data/device.ts); nothing is defined here.
  define: {},
});
