import { defineConfig } from 'vitest/config';

const SHARED_EXCLUDE = ['dist', 'node_modules'];

export const config = defineConfig({
  test: {
    coverage: {
      exclude: [
        'src/**/@types/**',
        'src/**/*.d.ts',
        'src/**/*.test.ts',
        'src/**/index.ts'
      ],
      include: ['src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage'
    },
    environment: 'node',
    exclude: [...SHARED_EXCLUDE, 'scripts/**'],
    globals: false,
    include: ['src/**/*.test.ts'],
    passWithNoTests: true
  }
});
