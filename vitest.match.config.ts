import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/ai-match.scenario.ts'],
    testTimeout: 7_200_000,
    hookTimeout: 7_200_000,
    reporters: ['verbose'],
  },
});
