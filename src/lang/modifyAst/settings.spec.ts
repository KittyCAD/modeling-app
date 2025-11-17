import { recast } from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import { join } from 'path'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import { setExperimentalFeatures } from '@src/lang/modifyAst/settings'
import { expect } from 'vitest'
const WASM_PATH = join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')

describe('settings.spec.ts', () => {
  describe('Testing setExperimentalFeatures', () => {
    it('should add the annotation and set the flag if not present', async () => {
      const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
      const newAst = setExperimentalFeatures('', { type: 'Allow' }, instance)
      if (err(newAst)) {
        throw newAst
      }

      const newCode = recast(newAst, instance)
      expect(newCode).toBe(`@settings(experimentalFeatures = allow)\n`)
    })

    it('should set the flag if the annotation exists', async () => {
      const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
      const code = `@settings(experimentalFeatures = warn)\n`
      const newAst = setExperimentalFeatures(code, { type: 'Deny' }, instance)
      if (err(newAst)) {
        throw newAst
      }

      const newCode = recast(newAst, instance)
      expect(newCode).toBe(`@settings(experimentalFeatures = deny)\n`)
    })
  })
})
