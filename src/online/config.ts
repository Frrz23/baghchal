/**
 * WebSocket base URL of the deployed room worker (no trailing slash, no path).
 * Priority: `VITE_WS_URL` env (set at deploy: `VITE_WS_URL=wss://… npm run
 * build`) → local `wrangler dev` when the page runs on localhost → ''.
 */
function defaultBase(): string {
  const env = import.meta.env.VITE_WS_URL as string | undefined;
  if (env) return env;
  if (typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    return 'ws://127.0.0.1:8787';
  }
  return '';
}

export const WS_BASE: string = defaultBase();
