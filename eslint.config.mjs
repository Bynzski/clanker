import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'release/**',
      'node_modules/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'vite.config.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      'no-restricted-globals': ['error', 'alert', 'confirm', 'prompt'],
      'no-restricted-syntax': ['error',
        { selector: "CallExpression[callee.type='MemberExpression'][callee.object.name=/^(window|globalThis)$/][callee.property.name=/^(alert|confirm|prompt)$/]", message: 'Use shared Dialog/AlertDialog for app-owned prompts.' },
        { selector: "CallExpression[callee.type='MemberExpression'][callee.property.name=/^(showMessageBox|showMessageBoxSync|showErrorBox)$/]", message: 'Use the renderer dialog handshake; OS file pickers remain native.' },
      ],
      'no-console': 'off',
      'no-control-regex': 'off',
      'react-hooks/refs': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['src/main/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['scripts/**/*.cjs', 'docs/**/experiments/*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
);
