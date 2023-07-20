module.exports = {
  testEnvironment: 'jsdom',
  preset: 'ts-jest/presets/js-with-ts',
  transform: {
    '^.+\\.(ts|tsx)?$': 'ts-jest',
    "^.+\\.(js|jsx)$": "babel-jest",
  },
  transformIgnorePatterns: [
    "//node_modules/(?!(ws|allotment|@tauri-apps/api|wasm-lib)/)",
  ],
  moduleNameMapper: {
    '^allotment$': 'allotment/dist/legacy',
  },
  setupFilesAfterEnv: ['./src/setupTests.ts'],
}
