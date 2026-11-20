import { readFileSync } from 'node:fs'
import { validateNativeConversion } from '@src/lib/stepConversion'
import { getModule, reloadModule } from '@src/lib/wasm_lib_wrapper'
import { beforeAll, expect, test } from 'vitest'

beforeAll(async () => {
  await reloadModule()
  getModule().initSync({ module: readFileSync('public/kcl_wasm_lib_bg.wasm') })
})

test('validates native import dependencies using the real KCL parser', () => {
  for (const code of [
    'import "source.step" as part',
    'import "missing.kcl" as part',
    'import "../external.kcl" as part',
    'width = (',
  ]) {
    expect(() => validateNativeConversion({ 'main.kcl': code })).toThrow()
  }
  expect(() =>
    validateNativeConversion({
      'main.kcl': 'import "parts/main.kcl" as bore',
      'parts/main.kcl': 'export diameter = 4mm',
    })
  ).not.toThrow()
})
