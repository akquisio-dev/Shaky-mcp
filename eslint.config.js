import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['error', { allow: ['error', 'warn'] }],
    },
  },
  {
    files: ['src/web/client/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
    rules: { 'no-console': 'off' },
  },
  {
    files: ['scripts/**', 'src/cli.ts', 'tests/**'],
    rules: { 'no-console': 'off' },
  },
);
