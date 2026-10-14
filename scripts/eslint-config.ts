/**
 * @file
 *
 * ESLint configuration for TypeScript projects with various plugins.
 *
 * This module exports ESLint configurations for TypeScript projects, integrating multiple ESLint plugins
 * such as `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`,
 * `@stylistic/eslint-plugin`.
 * It sets up parsers, plugins, and rules for maintaining code quality and consistency.
 */

import type { Linter } from 'eslint';

import commentsConfigs from '@eslint-community/eslint-plugin-eslint-comments/configs';
import eslint from '@eslint/js';
// eslint-disable-next-line import-x/no-rename-default -- The default export name `plugin` is too confusing.
import stylistic from '@stylistic/eslint-plugin';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import { flatConfigs as eslintPluginImportXFlatConfigs } from 'eslint-plugin-import-x';
// eslint-disable-next-line import-x/no-rename-default, import-x/no-named-as-default -- The default export name `index` is too confusing.
import jsdoc from 'eslint-plugin-jsdoc';
import { configs as perfectionistConfigs } from 'eslint-plugin-perfectionist';
/* v8 ignore start -- Declarative ESLint rule/plugin configuration; correctness is verified by running ESLint, not unit tests. */
import eslintPluginTsdoc from 'eslint-plugin-tsdoc';
// eslint-disable-next-line import-x/no-rename-default -- The default export name `eslintPluginUnicorn` restates the package name.
import unicorn from 'eslint-plugin-unicorn';
import {
  defineConfig,
  includeIgnoreFile
} from 'eslint/config';
import { existsSync } from 'node:fs';
import { join } from 'node:path/posix';
// eslint-disable-next-line import-x/no-rename-default -- The default export name `_default` is too confusing.
import tseslint from 'typescript-eslint';

import { obsidianDevUtilsPlugin } from './helpers/eslint-rules/obsidian-dev-utils-plugin.ts';
import { getRootFolder } from './helpers/root.ts';

const rootConfigFiles = [
  'commitlint.config.ts',
  'eslint.config.mts',
  'vitest.config.ts'
];
const sourceFiles = ['src/**/*.ts'];
const scriptFiles = ['scripts/**/*.ts'];
const testFiles = ['**/*.test.ts'];
const allFiles = [...sourceFiles, ...scriptFiles, ...rootConfigFiles];

/**
 * Build ESLint configurations.
 *
 * This function builds ESLint configurations for TypeScript projects, integrating multiple ESLint plugins
 *
 * @param params - The parameters for defining ESLint configurations.
 * @returns The ESLint configurations.
 */
export const configs = defineConfig(
  ...getGitIgnoreConfigs(),
  ...getEslintConfigs(),
  ...getTseslintConfigs(),
  ...getStylisticConfigs(),
  ...getImportXConfigs(),
  ...getPerfectionistConfigs(),
  ...getEslintImportResolverTypescriptConfigs(),
  ...getEslintCommentsConfigs(),
  ...getCustomPluginConfigs(),
  ...getJsdocsConfigs(),
  ...getNoRestrictedSyntaxRulesConfigs(),
  ...getTsdocsConfigs(),
  ...getUnicornConfigs()
);

function getCustomPluginConfigs(): Linter.Config[] {
  return defineConfig([
    {
      files: allFiles,
      plugins: {
        'obsidian-dev-utils': obsidianDevUtilsPlugin
      },
      rules: {
        'obsidian-dev-utils/no-unused-params-members': 'error',
        'obsidian-dev-utils/no-used-underscore-variables': 'error',
        'obsidian-dev-utils/params-options-name-match': 'error',
        'obsidian-dev-utils/readonly-params-options-result-members': 'error',
        'obsidian-dev-utils/require-method-template': 'error'
      }
    }
  ]);
}

function getEslintCommentsConfigs(): Linter.Config[] {
  return defineConfig([
    {
      // eslint-disable-next-line import-x/no-named-as-default-member -- The default export name `recommended` is too confusing.
      extends: [commentsConfigs.recommended],
      files: allFiles,
      rules: {
        '@eslint-community/eslint-comments/require-description': 'error'
      }
    }
  ]);
}

function getEslintConfigs(): Linter.Config[] {
  return defineConfig([
    {
      extends: [eslint.configs.recommended],
      files: allFiles,
      rules: {
        'accessor-pairs': 'error',
        'array-callback-return': 'error',
        'camelcase': 'error',
        /*
         * The rule reports per comment TOKEN, so every continuation line of a wrapped `//` comment is its own token
         * that would have to start with a capital — which is how prose ends up with capitals mid-sentence.
         * `ignoreConsecutiveComments` exempts a line comment that directly follows another one, which is exactly the
         * shape of a wrapped block, while still holding its FIRST line to a capital. Block comments need no such
         * option: a block comment is a single token however many lines it spans.
         * `ignorePattern` covers the half that leaves behind: a comment whose FIRST word is a camelCase identifier is
         * exempt, so a comment that opens by naming a symbol keeps the name a reader can grep instead of a PascalCase
         * one that exists nowhere. The rule anchors the pattern at the start of the comment and `[a-zA-Z0-9]` matches
         * no whitespace, so it can only ever match that first word — ordinary lowercase prose stays reported. Both
         * option bags need it, and `block` keeps its `v8` exemption by alternation rather than losing it.
         */
        'capitalized-comments': [
          'error',
          'always',
          {
            block: { ignorePattern: 'v8|[a-z][a-zA-Z0-9]*[A-Z]' },
            line: { ignoreConsecutiveComments: true, ignorePattern: '[a-z][a-zA-Z0-9]*[A-Z]' }
          }
        ],
        'complexity': 'error',
        'consistent-this': 'error',
        'curly': 'error',
        'default-case': 'error',
        'default-case-last': 'error',
        'default-param-last': 'error',
        'eqeqeq': 'error',
        'func-name-matching': 'error',
        'func-names': 'error',
        'func-style': [
          'error',
          'declaration',
          {
            allowArrowFunctions: false
          }
        ],
        'grouped-accessor-pairs': [
          'error',
          'getBeforeSet'
        ],
        'guard-for-in': 'error',
        'no-alert': 'error',
        'no-array-constructor': 'error',
        'no-bitwise': 'error',
        'no-caller': 'error',
        'no-console': [
          'error',
          {
            allow: [
              'warn',
              'error'
            ]
          }
        ],
        'no-constructor-return': 'error',
        'no-div-regex': 'error',
        'no-else-return': [
          'error',
          {
            allowElseIf: false
          }
        ],
        'no-empty-function': 'error',
        'no-extend-native': 'error',
        'no-extra-bind': 'error',
        'no-extra-label': 'error',
        'no-implicit-coercion': [
          'error',
          {
            allow: [
              '!!'
            ]
          }
        ],
        'no-implied-eval': 'error',
        'no-inner-declarations': 'error',
        'no-iterator': 'error',
        'no-label-var': 'error',
        'no-labels': 'error',
        'no-lone-blocks': 'error',
        'no-lonely-if': 'error',
        'no-loop-func': 'error',
        'no-magic-numbers': [
          'error',
          {
            detectObjects: true,
            enforceConst: true,
            ignore: [
              -1,
              0,
              1
            ]
          }
        ],
        'no-multi-assign': 'error',
        'no-multi-str': 'error',
        'no-negated-condition': 'error',
        'no-nested-ternary': 'error',
        'no-new-func': 'error',
        'no-new-wrappers': 'error',
        'no-object-constructor': 'error',
        'no-octal-escape': 'error',
        'no-promise-executor-return': 'error',
        'no-proto': 'error',
        'no-return-assign': 'error',
        'no-script-url': 'error',
        'no-self-compare': 'error',
        'no-sequences': 'error',
        'no-shadow': 'error',
        'no-template-curly-in-string': 'error',
        'no-throw-literal': 'error',
        'no-unmodified-loop-condition': 'error',
        'no-unneeded-ternary': 'error',
        'no-unreachable-loop': 'error',
        'no-unused-expressions': 'error',
        'no-useless-assignment': 'error',
        'no-useless-call': 'error',
        'no-useless-computed-key': 'error',
        'no-useless-concat': 'error',
        'no-useless-constructor': 'error',
        'no-useless-rename': 'error',
        'no-useless-return': 'error',
        'no-var': 'error',
        'no-void': 'error',
        'object-shorthand': 'error',
        'operator-assignment': 'error',
        'prefer-arrow-callback': 'error',
        'prefer-const': 'error',
        'prefer-exponentiation-operator': 'error',
        'prefer-named-capture-group': 'error',
        'prefer-numeric-literals': 'error',
        'prefer-object-has-own': 'error',
        'prefer-object-spread': 'error',
        'prefer-promise-reject-errors': 'error',
        'prefer-regex-literals': 'error',
        'prefer-rest-params': 'error',
        'prefer-spread': 'error',
        'prefer-template': 'error',
        'radix': 'error',
        'require-atomic-updates': 'error',
        'require-await': 'error',
        'symbol-description': 'error',
        'unicode-bom': 'error',
        'vars-on-top': 'error',
        'yoda': 'error'
      }
    },
    {
      files: [...testFiles, 'scripts/eslint-config.ts'],
      rules: {
        'no-magic-numbers': 'off'
      }
    },
    {
      files: scriptFiles,
      rules: {
        'no-console': 'off'
      }
    }
  ]);
}

function getEslintImportResolverTypescriptConfigs(): Linter.Config[] {
  return defineConfig([
    {
      settings: {
        'import-x/resolver-next': [
          createTypeScriptImportResolver({
            alwaysTryTypes: true
          })
        ]
      }
    }
  ]);
}

function getGitIgnoreConfigs(): Linter.Config[] {
  const gitignorePath = join(getRootFolder() ?? '', '.gitignore');
  return existsSync(gitignorePath) ? [includeIgnoreFile(gitignorePath)] : [];
}

function getImportXConfigs(): Linter.Config[] {
  return defineConfig([
    {
      extends: [
        eslintPluginImportXFlatConfigs.recommended,
        eslintPluginImportXFlatConfigs.typescript,
        eslintPluginImportXFlatConfigs.errors,
        eslintPluginImportXFlatConfigs.warnings
      ],
      files: allFiles,
      rules: {
        'import-x/consistent-type-specifier-style': 'error',
        'import-x/extensions': ['error', 'ignorePackages'],
        'import-x/first': 'error',
        'import-x/imports-first': 'error',
        'import-x/newline-after-import': 'error',
        'import-x/no-absolute-path': 'error',
        'import-x/no-amd': 'error',
        'import-x/no-anonymous-default-export': 'error',
        'import-x/no-commonjs': 'error',
        'import-x/no-cycle': 'error',
        'import-x/no-default-export': 'error',
        'import-x/no-deprecated': 'error',
        'import-x/no-duplicates': 'error',
        'import-x/no-dynamic-require': 'error',
        'import-x/no-empty-named-blocks': 'error',
        'import-x/no-extraneous-dependencies': 'error',
        'import-x/no-import-module-exports': 'error',
        'import-x/no-mutable-exports': 'error',
        'import-x/no-named-default': 'error',
        'import-x/no-namespace': 'error',
        'import-x/no-nodejs-modules': 'error',
        'import-x/no-relative-packages': 'error',
        'import-x/no-restricted-paths': 'error',
        'import-x/no-self-import': 'error',
        'import-x/no-unassigned-import': [
          'error',
          {
            allow: [
              '**/*.css',
              '**/*.sass',
              '**/*.scss'
            ]
          }
        ],
        'import-x/no-unused-modules': 'off',
        'import-x/no-useless-path-segments': 'error',
        'import-x/no-webpack-loader-syntax': 'error'
      }
    },
    {
      files: rootConfigFiles,
      rules: {
        'import-x/no-default-export': 'off'
      }
    },
    {
      files: scriptFiles,
      rules: {
        'import-x/no-nodejs-modules': 'off'
      }
    }
  ]);
}

function getJsdocsConfigs(): Linter.Config[] {
  return defineConfig([
    {
      ...jsdoc.configs['flat/recommended-typescript-error'],
      files: sourceFiles,
      ignores: testFiles
    },
    {
      files: sourceFiles,
      ignores: testFiles,
      plugins: {
        jsdoc
      },
      rules: {
        'jsdoc/check-tag-names': [
          'error',
          {
            definedTags: [
              'remarks',
              'typeParam'
            ]
          }
        ],
        /*
         * Empty JSDoc blocks are never a valid substitute for real documentation, regardless of how they appear
         * (hand-written or inserted by `jsdoc/require-jsdoc`'s autofix as a placeholder). `enableFixer: false` keeps
         * the empty block in place and reports it, forcing a real description to be written instead of silently
         * deleting the placeholder and re-triggering `require-jsdoc`.
         */
        'jsdoc/no-blank-blocks': ['error', { enableFixer: false }],
        'jsdoc/require-description': 'error',
        'jsdoc/require-file-overview': 'error',
        'jsdoc/require-jsdoc': [
          'error',
          {
            contexts: [
              {
                context: 'ExportNamedDeclaration > FunctionDeclaration'
              },
              {
                context: 'ExportDefaultDeclaration > FunctionDeclaration'
              },
              {
                context: 'ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > ArrowFunctionExpression'
              },
              {
                context: 'ExportDefaultDeclaration > ArrowFunctionExpression'
              },
              {
                context: 'ExportNamedDeclaration MethodDefinition:not([accessibility="private"])'
              },
              {
                context: 'ExportDefaultDeclaration MethodDefinition:not([accessibility="private"])'
              },
              {
                context: 'ExportNamedDeclaration > ClassDeclaration > ClassBody > PropertyDefinition:not([accessibility=\'private\'])'
              },
              {
                context: 'ExportDefaultDeclaration > ClassDeclaration > ClassBody > PropertyDefinition:not([accessibility=\'private\'])'
              },
              {
                context: 'ExportNamedDeclaration > ClassDeclaration > ClassBody > TSAbstractPropertyDefinition:not([accessibility=\'private\'])'
              },
              {
                context: 'ExportDefaultDeclaration > ClassDeclaration > ClassBody > TSAbstractPropertyDefinition:not([accessibility=\'private\'])'
              },
              {
                context: 'ExportNamedDeclaration > TSInterfaceDeclaration'
              },
              {
                context: 'ExportNamedDeclaration > TSTypeAliasDeclaration'
              },
              {
                context: 'ExportNamedDeclaration > TSEnumDeclaration'
              },
              {
                context: 'ExportNamedDeclaration > ClassDeclaration'
              },
              {
                context: 'ExportDefaultDeclaration > ClassDeclaration'
              }
            ],
            publicOnly: false,
            require: {
              ArrowFunctionExpression: false,
              ClassDeclaration: false,
              ClassExpression: false,
              FunctionDeclaration: false,
              MethodDefinition: false
            }
          }
        ],
        'jsdoc/require-throws-type': 'off',
        'jsdoc/tag-lines': [
          'error',
          'any',
          {
            startLines: 1
          }
        ]
      },
      settings: {
        jsdoc: {
          tagNamePreference: {
            template: 'typeParam'
          }
        }
      }
    }
  ]);
}

function getNoRestrictedSyntaxRulesConfigs(): Linter.Config[] {
  return defineConfig([
    {
      files: allFiles,
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            message: 'Do not use definite assignment assertions (!). Initialize the field or make it optional.',
            selector: 'PropertyDefinition[definite=true]'
          },
          {
            message: 'Do not use definite assignment assertions (!) on abstract fields.',
            selector: 'TSAbstractPropertyDefinition[definite=true]'
          },
          {
            message: 'Do not use double type assertions (as X as Y).',
            selector: 'TSAsExpression > TSAsExpression'
          },
          {
            message: 'Do not use _ prefix on methods or functions. The _ prefix is for unused parameters only.',
            selector: 'MethodDefinition[key.name=/^_/]:not([override=true])'
          },
          {
            message: 'Do not use _ prefix on methods or functions. The _ prefix is for unused parameters only.',
            selector: 'FunctionDeclaration[id.name=/^_/]'
          },
          {
            message: 'Do not rename imports with "Mock" in the alias. Mock classes are the canonical types — use the original name.',
            selector: 'ImportSpecifier[local.name=/Mock/]:not([imported.name=/Mock/])'
          },
          {
            message: 'Avoid dynamic import(). Use static imports instead. Only use dynamic imports for lazy/conditional loading.',
            selector: 'ImportExpression'
          },
          {
            message: 'Do not use `declare` on class properties. Initialize the property or use a regular type annotation.',
            selector: 'PropertyDefinition[declare=true]'
          },
          {
            message: 'Do not use anonymous inline object types. Define a named interface or `type` alias instead.',
            selector: 'TSTypeLiteral:not(TSTypeAliasDeclaration > TSTypeLiteral)'
          },
          {
            message: 'Do not use anonymous inline mapped types. Define a named `type` alias instead.',
            selector: 'TSMappedType:not(TSTypeAliasDeclaration > TSMappedType)'
          }
        ]
      }
    },
    {
      files: ['scripts/helpers/@types/**/*.d.ts'],
      rules: {
        'no-restricted-syntax': 'off'
      }
    }
  ]);
}

function getPerfectionistConfigs(): Linter.Config[] {
  return defineConfig([{
    extends: [perfectionistConfigs['recommended-alphabetical']],
    files: allFiles
  }]);
}

function getStylisticConfigs(): Linter.Config[] {
  return defineConfig([
    {
      extends: [
        stylistic.configs.recommended,
        stylistic.configs.customize({
          arrowParens: true,
          braceStyle: '1tbs',
          commaDangle: 'never',
          semi: true
        })
      ],
      files: allFiles,
      rules: {
        '@stylistic/generator-star-spacing': 'off',
        '@stylistic/indent': 'off',
        '@stylistic/indent-binary-ops': 'off',
        '@stylistic/jsx-one-expression-per-line': 'off',
        '@stylistic/no-extra-semi': 'error',
        '@stylistic/object-curly-newline': [
          'error',
          {
            ExportDeclaration: {
              minProperties: 2,
              multiline: true
            },
            ImportDeclaration: {
              minProperties: 2,
              multiline: true
            }
          }
        ],
        '@stylistic/operator-linebreak': [
          'error',
          'before',
          {
            overrides: {
              '=': 'after'
            }
          }
        ],
        '@stylistic/quotes': [
          'error',
          'single',
          {
            allowTemplateLiterals: 'never'
          }
        ]
      }
    }
  ]);
}

function getTsdocsConfigs(): Linter.Config[] {
  return defineConfig([
    {
      files: sourceFiles,
      ignores: testFiles,
      plugins: {
        tsdoc: eslintPluginTsdoc
      }
    }
  ]);
}

function getTseslintConfigs(): Linter.Config[] {
  return defineConfig([
    {
      extends: [
        // eslint-disable-next-line import-x/no-named-as-default-member -- The default export name `_default` is too confusing.
        ...tseslint.configs.strictTypeChecked,
        // eslint-disable-next-line import-x/no-named-as-default-member -- The default export name `_default` is too confusing.
        ...tseslint.configs.stylisticTypeChecked
      ],
      files: allFiles,
      languageOptions: {
        parserOptions: {
          ecmaFeatures: {
            jsx: true
          },
          projectService: true,
          // eslint-disable-next-line unicorn/name-replacements -- `tsconfigRootDir` is `typescript-eslint`'s option name, which has to be spelled the way `typescript-eslint` reads it.
          tsconfigRootDir: getRootFolder() ?? ''
        }
      },
      rules: {
        '@typescript-eslint/explicit-function-return-type': 'error',
        '@typescript-eslint/explicit-member-accessibility': 'error',
        // The rule's own `property` default, spelled as a bare severity so it stays the rule's default rather than a copy of it.
        // Do NOT pass `'method'` for tidiness: the method form keeps parameters bivariant, drops `readonly` (the rule's own fixer
        // message says so), and makes `@typescript-eslint/unbound-method` fire on every forwarded bag member, which is what the
        // `this: void` boilerplate used to pay for. Do NOT delete the line either - the rule is in no preset, so that turns it off.
        '@typescript-eslint/method-signature-style': 'error',
        '@typescript-eslint/no-invalid-void-type': ['error', {
          allowAsThisParameter: true
        }],
        '@typescript-eslint/no-this-alias': ['error', {
          allowedNames: [
            'that'
          ]
        }],
        '@typescript-eslint/no-unused-vars': [
          'error',
          {
            // eslint-disable-next-line unicorn/name-replacements -- `args` is ESLint's option name, which has to be spelled the way ESLint reads it.
            args: 'all',
            // eslint-disable-next-line unicorn/name-replacements -- `argsIgnorePattern` is `typescript-eslint`'s option name, which has to be spelled the way `typescript-eslint` reads it.
            argsIgnorePattern: '^_',
            caughtErrors: 'all',
            caughtErrorsIgnorePattern: '^_',
            destructuredArrayIgnorePattern: '^_',
            ignoreRestSiblings: true,
            // eslint-disable-next-line unicorn/name-replacements -- `varsIgnorePattern` is `typescript-eslint`'s option name, which has to be spelled the way `typescript-eslint` reads it.
            varsIgnorePattern: '^_'
          }
        ],
        '@typescript-eslint/prefer-readonly': 'error',
        'obsidian-dev-utils/no-async-callback-to-unsafe-return': 'error',
        'obsidian-dev-utils/no-used-underscore-variables': 'error'
      }
    }
  ]);
}

function getUnicornConfigs(): Linter.Config[] {
  return defineConfig([
    {
      extends: [unicorn.configs.recommended],
      files: allFiles,
      rules: {
        /*
         * The rule's default prefixes force ungrammatical names, so these two EXTEND the defaults (`is`, `are`,
         * `has`, `can`, `should`, ...) rather than replace them — a boolean with no boolean-reading prefix at all
         * is still rejected. Only the two the repo actually needs are added, rather than the longer list the
         * sibling configs carry: the list is bidirectional, so every prefix added also asserts that anything
         * named with it IS a boolean, and an entry no report asks for buys that assertion for nothing. `check`
         * answers `checkProjectTypes`, and `contains` answers `containsPromiseReference` in a vendored rule
         * source, which cannot be renamed here at all.
         */
        'unicorn/consistent-boolean-name': [
          'error',
          {
            prefixes: {
              check: true,
              contains: true
            }
          }
        ],
        /*
         * The default style for `node:path` is a default import, but every `node:` module here is imported by
         * name. Configure the rule to enforce the style actually in use.
         */
        'unicorn/import-style': [
          'error',
          {
            styles: {
              // Keyed by the UNPREFIXED module name: the rule's own table uses `path`, so a `node:path` key never matches.
              path: {
                named: true
              }
            }
          }
        ],
        /*
         * `checkProperties` is load-bearing rather than a preference: the two inline `unicorn/name-replacements`
         * disables that `scripts/helpers/eslint-rules/require-method-template.ts` takes from upstream sit on the
         * object property `paramName:`, and the rule's default never reaches a property — so with the default
         * they would be UNUSED directives, which `lint:fix` deletes, rewriting a file
         * `check:vendored-eslint-rules` asserts byte-identity on.
         *
         * Each disabled replacement below is established vocabulary here, and each answers a report that was
         * measured rather than anticipated:
         *
         * - `params` is the parameter-bag convention that `obsidian-dev-utils/params-options-name-match` above
         *   ENFORCES — bag types must be named `<Owner>Params` / `<Owner>Options` — so expanding it would put
         *   the two rules in direct contradiction.
         * - `docs` is ESLint's own `meta.docs` key, which every rule source here declares.
         * - `dev` and `utils` spell the `obsidian-dev-utils` plugin namespace these custom rules are registered
         *   under, so expanding them would rename the plugin after nothing.
         * - `env` and `lib` name foreign surfaces: environment variables, and TypeScript's `skipLibCheck`.
         *
         * NOTE: this rule's autofix is NOT reference-aware for declarations that participate in a contract —
         * enum members, interface members and TypeScript parameter properties are renamed while their references
         * are left dangling. Apply its reports by hand; never run `--fix` over it.
         */
        'unicorn/name-replacements': [
          'error',
          {
            checkProperties: true,
            replacements: {
              dev: false,
              docs: false,
              env: false,
              lib: false,
              params: false,
              utils: false
            }
          }
        ],
        /*
         * `null` is the absent-value convention this repo's helpers are typed on: `getRootFolder`,
         * `readIndexContent` and `fetchUpstreamText` all declare `null | T` and are read through `=== null`, and
         * the Node APIs beneath them (`spawn`'s `stdio` slots, `execSync`'s `encoding`) hand back `null` too.
         * The rule cannot tell that convention from an accidental `null`, and following it would mean retyping
         * the surface rather than annotating a site.
         */
        'unicorn/no-null': 'off',
        /*
         * `checkArrowFunctionBody` rewrites `() => undefined` to `() => {}`, which `no-empty-function` above
         * reports — the two rules are in direct contradiction on the one site that fires
         * (`mockImplementation(() => undefined)`). The rule's remaining cases are still worth having.
         */
        'unicorn/no-useless-undefined': [
          'error',
          {
            checkArrowFunctionBody: false
          }
        ],
        // The repo already spells encodings the way the Encoding Standard does (`utf-8`), which is also what `TextDecoder` reports. Keep the rule enforcing consistency, in the direction already in use.
        'unicorn/text-encoding-identifier-case': [
          'error',
          {
            withDash: true
          }
        ]
      }
    },
    {
      // Every script here is a CLI entry point, where exiting with a status code is the interface — the same reason `no-console` is carved out for them above.
      files: scriptFiles,
      rules: {
        'unicorn/no-process-exit': 'off',
        /*
         * Every report is `const [, , ...rest] = process.argv`, whose two ignored slots are the node binary and
         * the script path. That is what `process.argv` IS, and naming the two holes adds no information.
         */
        'unicorn/no-unreadable-array-destructuring': 'off'
      }
    },
    {
      /*
       * A module-level fixture assigned from `beforeEach` is the standard test shape. The rule is right about
       * production code, where the fix is to hold the state in a `const` object instead; in tests that would
       * replace every `temporaryRoot` with `STATE.temporaryRoot` and make the file read worse, since the fixture
       * is reset per test by design.
       */
      files: testFiles,
      rules: {
        'unicorn/no-top-level-assignment-in-function': 'off'
      }
    },
    {
      /*
       * A generated declaration file, reproduced from `markdownlint-cli2`'s own JSON schema. Its union member
       * order and its type names both come from the generator, so neither is ours to change: renaming a type
       * here would just be undone the next time the schema is regenerated, and the three repos that carry this
       * file carry it byte-identically.
       */
      files: ['scripts/helpers/@types/markdownlint-cli2-config-schema.d.ts'],
      rules: {
        'unicorn/name-replacements': 'off',
        'unicorn/prefer-type-literal-last': 'off'
      }
    },
    {
      /*
       * `toArray` is shared byte-for-byte with `obsidian-test-mocks` and `obsidian-typings-crawler`, which
       * compile on an ES2022 floor where `Array.fromAsync` does not exist. It is reachable here (`lib: ES2024`),
       * but following the rule would collapse a generic helper into a one-line wrapper and make this the only
       * copy of an otherwise identical file. Scoped to the one file rather than turned off outright, so the rest
       * of the repo keeps the check.
       */
      files: ['scripts/helpers/markdownlint.ts'],
      rules: {
        'unicorn/prefer-array-from-async': 'off'
      }
    },
    {
      /*
       * Shared byte-for-byte with `obsidian-test-mocks`, whose config raises this rule's limit to 4 across the
       * repo, so the peer lints its copy at a depth this repo's default of 3 reports: the binary-index case nests
       * `readFileSync(join(...))` inside `equals(...)` inside `expect(...)`. Matching the peer's limit on this one
       * file keeps it takeable whole; the rest of the repo keeps the default.
       */
      files: ['scripts/helpers/git-content.test.ts'],
      rules: {
        'unicorn/max-nested-calls': [
          'error',
          {
            max: 4
          }
        ]
      }
    },
    {
      /*
       * These are VENDORED byte-identical copies of `obsidian-dev-utils`' rule sources, asserted by
       * `npm run check:vendored-eslint-rules` — so a report here can never be answered by editing the file, and
       * upstream carries no inline disable for either rule because it turns both off in its own config.
       *
       * What is deliberately NOT turned off here is `unicorn/no-useless-recursion` and
       * `unicorn/name-replacements`, which upstream DOES answer with inline disables. Keeping them on is what
       * makes those three directives used rather than unused, and so what lets this repo take upstream's bytes
       * whole instead of stripping the lines — see the transform arms in `scripts/check-vendored-eslint-rules.ts`.
       */
      files: ['scripts/helpers/eslint-rules/**/*.ts'],
      rules: {
        'unicorn/no-break-in-nested-loop': 'off',
        'unicorn/no-unreadable-for-of-expression': 'off'
      }
    }
  ]);
}

/* v8 ignore stop */
