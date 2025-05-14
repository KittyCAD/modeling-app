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
  // TAG: paths, path, baseUrl, alias
  // This is necessary to use tsconfig path aliases.
  moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths, { prefix: '<rootDir>/../' }),
}

export default jestConfig
