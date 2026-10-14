import { defineConfig } from 'vitest/config';

const SHARED_EXCLUDE = ['dist', 'node_modules'];
const ESLINT_RULE_TEST_FILES = 'scripts/helpers/eslint-rules/*.test.ts';
const SCRIPTS_TEST_FILES = 'scripts/**/*.test.ts';

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
    exclude: SHARED_EXCLUDE,
    globals: false,
    passWithNoTests: true,
    projects: [
      {
        test: {
          environment: 'node',
          exclude: [...SHARED_EXCLUDE, 'scripts/**'],
          include: ['src/**/*.test.ts'],
          name: 'unit-tests'
        }
      },
      {
        test: {
          environment: 'node',
          include: [ESLINT_RULE_TEST_FILES],
          // The rule tester keeps module-level state, so the rule tests must run serially in a single worker without isolation.
          isolate: false,
          maxWorkers: 1,
          name: 'eslint-rules',
          /*
           * Its own group, because `maxWorkers: 1` is incompatible with every sibling project that leaves
           * the worker count at the default: Vitest groups specs by `sequence.groupOrder` and throws
           * "Projects ... have different 'maxWorkers' but same 'sequence.groupOrder'" when one group holds
           * two of them -- the whole run then collects nothing at all, in a single unhandled error rather
           * than a failing test. Measured on vitest 4.1.10, so this is not a Vitest 5 concern deferred to
           * an upgrade. It stayed invisible here only because `src/` is empty: `unit-tests` contributed no
           * specs, so until `unit-tests:scripts` below arrived there was never a second project in group 0
           * to collide with. The delta belongs on this project rather than on its siblings, since this is
           * the one asking for the non-default worker count.
           */
          sequence: { groupOrder: 1 }
        }
      },
      {
        /*
         * The rest of the scripts tree, which until now was collected by nothing: `unit-tests` excludes
         * `scripts/**` outright and the project above takes only the eslint-rules folder, so a test file
         * added anywhere else under `scripts/` ran nowhere and `npm test` stayed green while proving
         * nothing. `scripts/helpers/package-manager.test.ts` was the first such file and is the reason this
         * project exists; it is a byte-identical copy shared with `obsidian-test-mocks`, which runs it in a
         * project of this same name and shape.
         *
         * The eslint-rules glob is excluded rather than left to overlap, so each file is collected exactly
         * once and the serial single-worker settings the rule tester needs stay confined to the project
         * that needs them. This project deliberately sets neither `isolate` nor `maxWorkers`.
         */
        test: {
          environment: 'node',
          exclude: [...SHARED_EXCLUDE, ESLINT_RULE_TEST_FILES],
          include: [SCRIPTS_TEST_FILES],
          name: 'unit-tests:scripts'
        }
      }
    ]
  }
});
