import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // amazon-cognito-identity-js (via its crypto deps) references Node's
  // `global`, which browsers don't have and Vite doesn't polyfill by
  // default — without this the app throws `ReferenceError: global is
  // not defined` at load time, before anything renders.
  define: {
    global: 'globalThis',
  },
});
