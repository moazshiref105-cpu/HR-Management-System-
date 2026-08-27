export default [{
  files: ['src/**/*.{js,jsx}'],
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } }, globals: { window: 'readonly', location: 'readonly', addEventListener: 'readonly', removeEventListener: 'readonly' } },
  rules: {},
}]
