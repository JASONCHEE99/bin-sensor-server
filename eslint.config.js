import js from '@eslint/js';

export default [
  {
    ignores: ['node_modules/**', 'coverage/**'],
  },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
    },
    files: ['**/*.js'],
    rules: {
      'no-console': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  js.configs.recommended,
];
