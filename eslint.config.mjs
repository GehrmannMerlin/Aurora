import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/coverage/**', '**/dist/**', '**/node_modules/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: [
      'tooling/workspace-policy/**/*.ts',
      'packages/event-schema/**/*.ts',
      'packages/core/**/*.ts',
      'packages/browser/**/*.ts',
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
  {
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'navigator',
        'location',
        'fetch',
        'XMLHttpRequest',
        'localStorage',
        'sessionStorage',
      ],
    },
  },
  {
    files: ['packages/browser/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'AssignmentExpression[left.object.name=/^(window|document|navigator|performance|globalThis)$/]',
          message: 'Browser source must not assign to host globals.',
        },
        {
          selector: "AssignmentExpression[left.object.property.name='prototype']",
          message: 'Browser source must not modify native prototypes.',
        },
        {
          selector:
            "CallExpression[callee.object.name='Object'][callee.property.name=/^(assign|defineProperty)$/]",
          message:
            'Browser host mutation through Object mutators is forbidden by Workspace Policy.',
        },
        {
          selector: "CallExpression[callee.object.name='Reflect'][callee.property.name='set']",
          message: 'Browser host mutation through Reflect.set is forbidden by Workspace Policy.',
        },
      ],
    },
  },
);
