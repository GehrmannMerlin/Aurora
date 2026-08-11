import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/coverage/**', '**/dist/**', '**/node_modules/**', '**/.migrations-combined/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: [
      'tooling/workspace-policy/**/*.ts',
      'tooling/ingestion-openapi-contract/**/*.ts',
      'tooling/platform-contract-drift/**/*.ts',
      'tooling/aws-infra/**/*.ts',
      'tooling/aurora-release/**/*.ts',
      'tooling/ingestion-benchmark/**/*.ts',
      'packages/event-schema/**/*.ts',
      'packages/core/**/*.ts',
      'packages/browser/**/*.ts',
      'packages/plugin-error/**/*.ts',
      'packages/plugin-request/**/*.ts',
      'packages/plugin-performance/**/*.ts',
      'packages/plugin-vue/**/*.ts',
      'packages/plugin-react/**/*.ts',
      'packages/ingestion-credentials/**/*.ts',
      'packages/ingestion-inbox/**/*.ts',
      'packages/processing-store/**/*.ts',
      'packages/platform-contract/**/*.ts',
      'packages/platform-identity/**/*.ts',
      'packages/platform-organization/**/*.ts',
      'packages/platform-project-governance/**/*.ts',
      'packages/platform-credentials/**/*.ts',
      'packages/platform-audit/**/*.ts',
      'packages/platform-session/**/*.ts',
      'packages/platform-email/**/*.ts',
      'apps/ingestion-api/**/*.ts',
      'apps/ingestion-worker/**/*.ts',
      'apps/platform-api/**/*.ts',
      'apps/platform-worker/**/*.ts',
      'apps/console/**/*.ts',
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
        { name: 'process', message: 'Core must not use Node runtime globals.' },
        { name: 'Buffer', message: 'Core must not use Node runtime globals.' },
        { name: 'require', message: 'Core must not use Node runtime globals.' },
        { name: 'module', message: 'Core must not use Node runtime globals.' },
        { name: '__dirname', message: 'Core must not use Node runtime globals.' },
        { name: '__filename', message: 'Core must not use Node runtime globals.' },
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
  {
    // request-observer.ts intentionally installs window.fetch and window.XMLHttpRequest
    // wrappers (first subscriber) and restores the original host references (last release).
    // This is the ADR-003 shared-proxy + reference-count capability. The wrapper install goes
    // through host.windowTarget member access, so a bare `window`/`document` Reflect.set or
    // assignment still stays forbidden; every prototype change, handler override, and
    // body/header read remains forbidden by the base browser block.
    files: ['packages/browser/src/request-observer.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'AssignmentExpression[left.object.name=/^(window|document|navigator|performance|globalThis)$/]',
          message: 'Browser source must not assign to host globals.',
        },
        {
          selector:
            "CallExpression[callee.object.name='Reflect'][callee.property.name='set'][arguments.0.name=/^(window|document|navigator|performance|globalThis)$/]",
          message: 'Browser host mutation through Reflect.set is forbidden by Workspace Policy.',
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
      ],
    },
  },
  {
    files: ['packages/plugin-error/src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'navigator',
        'location',
        'globalThis',
        'fetch',
        'XMLHttpRequest',
        'localStorage',
        'sessionStorage',
        { name: 'process', message: 'Plugin source must not use Node runtime globals.' },
        { name: 'Buffer', message: 'Plugin source must not use Node runtime globals.' },
        { name: 'require', message: 'Plugin source must not use Node runtime globals.' },
        { name: 'module', message: 'Plugin source must not use Node runtime globals.' },
        { name: '__dirname', message: 'Plugin source must not use Node runtime globals.' },
        { name: '__filename', message: 'Plugin source must not use Node runtime globals.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'AssignmentExpression[left.object.name=/^(window|document|navigator|performance|globalThis)$/]',
          message: 'Plugin source must not assign to host globals.',
        },
        {
          selector: "AssignmentExpression[left.object.property.name='prototype']",
          message: 'Plugin source must not modify native prototypes.',
        },
        {
          selector:
            "CallExpression[callee.object.name='Object'][callee.property.name=/^(assign|defineProperty)$/]",
          message: 'Plugin host mutation through Object mutators is forbidden by Workspace Policy.',
        },
        {
          selector: "CallExpression[callee.object.name='Reflect'][callee.property.name='set']",
          message: 'Plugin host mutation through Reflect.set is forbidden by Workspace Policy.',
        },
        {
          selector:
            'CallExpression[callee.property.name=/^(preventDefault|stopPropagation|stopImmediatePropagation)$/]',
          message: 'Plugin source must not control host event defaults or propagation.',
        },
      ],
    },
  },
  {
    files: ['packages/plugin-request/src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'navigator',
        'location',
        'globalThis',
        'fetch',
        'XMLHttpRequest',
        'localStorage',
        'sessionStorage',
        { name: 'process', message: 'Plugin source must not use Node runtime globals.' },
        { name: 'Buffer', message: 'Plugin source must not use Node runtime globals.' },
        { name: 'require', message: 'Plugin source must not use Node runtime globals.' },
        { name: 'module', message: 'Plugin source must not use Node runtime globals.' },
        { name: '__dirname', message: 'Plugin source must not use Node runtime globals.' },
        { name: '__filename', message: 'Plugin source must not use Node runtime globals.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'AssignmentExpression[left.object.name=/^(window|document|navigator|performance|globalThis)$/]',
          message: 'Plugin source must not assign to host globals.',
        },
        {
          selector: "AssignmentExpression[left.object.property.name='prototype']",
          message: 'Plugin source must not modify native prototypes.',
        },
        {
          selector:
            "CallExpression[callee.object.name='Object'][callee.property.name=/^(assign|defineProperty)$/]",
          message: 'Plugin host mutation through Object mutators is forbidden by Workspace Policy.',
        },
        {
          selector: "CallExpression[callee.object.name='Reflect'][callee.property.name='set']",
          message: 'Plugin host mutation through Reflect.set is forbidden by Workspace Policy.',
        },
        {
          selector:
            'CallExpression[callee.property.name=/^(preventDefault|stopPropagation|stopImmediatePropagation)$/]',
          message: 'Plugin source must not control host event defaults or propagation.',
        },
      ],
    },
  },
  {
    files: ['packages/plugin-performance/src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'navigator',
        'location',
        'globalThis',
        'fetch',
        'XMLHttpRequest',
        'localStorage',
        'sessionStorage',
        { name: 'process', message: 'Plugin source must not use Node runtime globals.' },
        { name: 'Buffer', message: 'Plugin source must not use Node runtime globals.' },
        { name: 'require', message: 'Plugin source must not use Node runtime globals.' },
        { name: 'module', message: 'Plugin source must not use Node runtime globals.' },
        { name: '__dirname', message: 'Plugin source must not use Node runtime globals.' },
        { name: '__filename', message: 'Plugin source must not use Node runtime globals.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'AssignmentExpression[left.object.name=/^(window|document|navigator|performance|globalThis)$/]',
          message: 'Plugin source must not assign to host globals.',
        },
        {
          selector: "AssignmentExpression[left.object.property.name='prototype']",
          message: 'Plugin source must not modify native prototypes.',
        },
        {
          selector:
            "CallExpression[callee.object.name='Object'][callee.property.name=/^(assign|defineProperty)$/]",
          message: 'Plugin host mutation through Object mutators is forbidden by Workspace Policy.',
        },
        {
          selector: "CallExpression[callee.object.name='Reflect'][callee.property.name='set']",
          message: 'Plugin host mutation through Reflect.set is forbidden by Workspace Policy.',
        },
        {
          selector:
            'CallExpression[callee.property.name=/^(preventDefault|stopPropagation|stopImmediatePropagation)$/]',
          message: 'Plugin source must not control host event defaults or propagation.',
        },
      ],
    },
  },
);
