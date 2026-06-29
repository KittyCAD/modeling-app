const rootConfig = require('../../tailwind.config.js')

module.exports = {
  ...rootConfig,
  content: [
    './.storybook/**/*.{js,jsx,ts,tsx}',
    './src/**/*.{js,jsx,ts,tsx}',
    '../../src/**/*.{js,jsx,ts,tsx}',
  ],
}
