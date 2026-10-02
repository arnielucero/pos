import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Injects a strict Content-Security-Policy into production bundles (not in dev, where Vite
 * needs inline scripts for HMR). connect-src is limited to the configured API origin.
 */
function contentSecurityPolicy(apiBaseUrl: string): Plugin {
  const apiOrigin = apiBaseUrl.startsWith('/') ? '' : new URL(apiBaseUrl).origin;
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    `connect-src 'self' ${apiOrigin}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return {
    name: 'hmr-pos-csp',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head-prepend' }],
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react(), contentSecurityPolicy(env['VITE_API_BASE_URL'] ?? 'http://127.0.0.1:8080/api/v1')],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: 5173,
      strictPort: true,
      host: '127.0.0.1',
      // Dev only: same-origin proxy to the Laravel API so the browser needs no CORS setup.
      proxy: {
        '/api': { target: env['VITE_DEV_PROXY_TARGET'] ?? 'http://127.0.0.1:8080', changeOrigin: true },
      },
    },
    build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 1500 },
  };
});
