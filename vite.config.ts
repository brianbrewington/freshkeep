import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs so a build can be served from any subpath, not just the
  // document root (e.g. http://host/~user/freshkeep/).
  base: './',
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
} as any);
