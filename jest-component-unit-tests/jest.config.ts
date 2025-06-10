import { pathsToModuleNameMapper } from 'ts-jest'
// In the following statement, replace `./tsconfig` with the path to your `tsconfig` file
// which contains the path mapping (ie the `compilerOptions.paths` option):
import { compilerOptions } from './tsconfig.json'
import type { Config } from 'jest'

const jestConfig: Config = {
  // [...]
  preset: "ts-jest",
  transform: {
    "^.+\.tsx?$": ["ts-jest",{ babelConfig: true }],
  },
  testEnvironment: "jest-fixed-jsdom",
  // Include both standard test patterns and our custom .jesttest. pattern
  testMatch: [
    "**/__tests__/**/*.[jt]s?(x)",
    "**/?(*.)+(spec|test).[tj]s?(x)",
    "**/?(*.)+(jesttest).[tj]s?(x)"
  ],
  // TAG: paths, path, baseUrl, alias
  // This is necessary to use tsconfig path aliases.
  moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths, { prefix: '<rootDir>/../' }),
}

export default jestConfig
