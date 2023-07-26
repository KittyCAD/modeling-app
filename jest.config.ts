import type { Config } from 'jest'

const config: Config = {
  testEnvironment: 'jsdom',
  preset: 'ts-jest/presets/js-with-ts',
  transform: {
    '^.+\\.(ts|tsx)?$': 'ts-jest',
    '^.+\\.(js|jsx)$': 'babel-jest',
  },
  transformIgnorePatterns: ['//node_modules/(?!(allotment|@tauri-apps/api)/)'],
  moduleNameMapper: {
    '^allotment$': 'allotment/dist/legacy',
  },
  setupFilesAfterEnv: ['./src/setupTests.ts'],
  reporters: [['github-actions', { silent: false }], 'summary'],
}

export default config
