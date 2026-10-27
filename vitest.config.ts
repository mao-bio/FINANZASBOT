import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './worker/index.ts',
      remoteBindings: false,
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: { APP_PASSWORD: 'clave-de-prueba', APP_USERNAME: 'Mario' },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
  },
});
