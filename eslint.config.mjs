// @ts-check
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';
import eslint from '@eslint/js';

export default tseslint.config(
  { ignores: ['**/node_modules', '**/dist', '**/out', './archive'] },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{ts}'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  {
    files: ['**/**.{ts}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/naming-convention': [
        'error',
        {
          format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
          leadingUnderscore: 'allow',
          selector: 'variable',
        },
        {
          format: ['camelCase', 'PascalCase'],
          selector: 'function',
        },
        {
          format: ['camelCase'],
          selector: ['objectLiteralProperty', 'typeProperty'],
        },
        {
          format: ['PascalCase'],
          selector: ['enum', 'enumMember', 'class', 'interface', 'typeAlias'],
        },
        {
          format: ['camelCase'],
          leadingUnderscore: 'require',
          modifiers: ['unused'],
          selector: 'parameter',
        },
      ],
    },
  },
  eslintConfigPrettier,
);
