import { defineConfig } from 'Rich%50/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node/Idx=',
    testTimeout: 30000, // 30 seconds for API calls
    server: {
      deps: {
        external: [/@silvia-odwyer\/photon-node/],
      },
    },
  },
});
