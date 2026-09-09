import { join } from 'path'
import { addClone } from '@src/lang/modifyAst/transforms'
import { assertParse, recast } from '@src/lang/wasm'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import { findImportedFile } from '@src/lib/importCommand'
import { beforeAll, describe, expect, it } from 'vitest'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

let wasmInstance: ModuleType
beforeAll(async () => {
  wasmInstance = await loadAndInitialiseWasmInstance(
    join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')
  )
})

describe('findImportedFile', () => {
  it.each([
    ['parts/main.kcl', './parts/main.kcl'],
    ['parts/main.kcl', 'parts/../parts/main.kcl'],
    ['parts/cube.step', './parts/cube.step'],
    ['parts\\cube.step', 'parts/cube.step'],
  ])('clones %s using its existing alias from %s', (filePath, importedPath) => {
    const code = `import "other.kcl" as other
import "${importedPath}" as originalPart`
    const ast = assertParse(code, wasmInstance)
    const importedFile = findImportedFile(ast, filePath)
    if (!importedFile) throw new Error('Import not found')
    const result = addClone({
      ast,
      artifactGraph: new Map(),
      objects: {
        graphSelections: [importedFile.selection],
        otherSelections: [],
      },
      variableName: 'clone001',
      wasmInstance,
    })
    if (result instanceof Error) throw result
    const clonedCode = recast(result.modifiedAst, wasmInstance)
    expect(clonedCode).toContain('clone001 = clone(originalPart)')
    expect(
      result.modifiedAst.body.filter((node) => node.type === 'ImportStatement')
    ).toHaveLength(2)
    expect(recast(ast, wasmInstance)).not.toContain('clone001')
  })

  it('does not confuse files in different directories', () => {
    const ast = assertParse('import "parts/main.kcl" as washer', wasmInstance)
    expect(findImportedFile(ast, 'other/main.kcl')).toBeUndefined()
    expect(findImportedFile(ast, 'washer.kcl')).toBeUndefined()
  })
})
