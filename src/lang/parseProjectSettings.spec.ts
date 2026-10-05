import { join } from 'node:path'
import { parseProjectSettings } from '@src/lang/wasm'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import {
  invalidProjectConfigurationCases,
  projectConfigurationCases,
} from '@src/lib/settings/projectConfiguration.fixtures'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { beforeAll, describe, expect, it } from 'vitest'

let wasmInstance: ModuleType

beforeAll(async () => {
  wasmInstance = await loadAndInitialiseWasmInstance(
    join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')
  )
})

describe('parseProjectSettings characterization', () => {
  it.each(projectConfigurationCases)('$description', ({ toml, expected }) => {
    expect(parseProjectSettings(toml, wasmInstance)).toEqual(expected)
  })

  it.each(invalidProjectConfigurationCases)(
    'throws a string for invalid project settings: %j',
    (toml) => {
      let failure: unknown
      try {
        parseProjectSettings(toml, wasmInstance)
      } catch (cause) {
        failure = cause
      }
      expect(typeof failure).toBe('string')
      expect(failure).toEqual(expect.stringContaining('TOML parse error'))
    }
  )
})
