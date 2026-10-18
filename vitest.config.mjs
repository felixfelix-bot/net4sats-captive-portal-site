import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // cashu.js imports helpers/net4sats.js, which reads window.location.hostname at
    // module load, so the helpers cannot be exercised without a DOM.
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
  },
});
