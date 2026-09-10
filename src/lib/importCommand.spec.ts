import { join } from 'path'
import { assertParse, recast } from '@src/lang/wasm'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import { addImportOrClone, findImportedFile } from '@src/lib/importCommand'
import { beforeAll, describe, expect, it } from 'vitest'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

let wasmInstance: ModuleType
beforeAll(async () => {
  wasmInstance = await loadAndInitialiseWasmInstance(
    join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')
  )
})

describe('addImportOrClone', () => {
  it.each([
    ['parts/main.kcl', './parts/main.kcl'],
    ['parts/main.kcl', 'parts/../parts/main.kcl'],
    ['parts/cube.step', './parts/cube.step'],
    ['parts\\cube.step', 'parts/cube.step'],
  ])('clones %s using its existing alias from %s', (filePath, importedPath) => {
    const code = `import "other.kcl" as other
import "${importedPath}" as originalPart`
    const ast = assertParse(code, wasmInstance)
    const result = addImportOrClone({
      ast,
      artifactGraph: new Map(),
      path: filePath,
      localName: 'myInstance',
      wasmInstance,
    })
    if (result instanceof Error) throw result
    const clonedCode = recast(result.modifiedAst, wasmInstance)
    expect(clonedCode).toContain('myInstance = clone(originalPart)')
    expect(
      result.modifiedAst.body.filter((node) => node.type === 'ImportStatement')
    ).toHaveLength(2)
    expect(recast(ast, wasmInstance)).not.toContain('myInstance')
  })

  it('adds a new import with the requested STEP representation', () => {
    const ast = assertParse('import "washer.kcl" as washer', wasmInstance)
    const result = addImportOrClone({
      ast,
      path: 'cube.step',
      localName: 'cube',
      representation: 'brep',
      artifactGraph: new Map(),
      wasmInstance,
    })
    if (result instanceof Error) throw result
    const code = recast(result.modifiedAst, wasmInstance)
    expect(code).toContain(
      '@(targetRepresentation = brep)\nimport "cube.step" as cube'
    )
    expect(code).not.toContain('clone(')
    expect(recast(ast, wasmInstance)).not.toContain('cube')
  })

  it('keeps the original STEP representation when cloning', () => {
    const ast = assertParse(
      '@(targetRepresentation = brep)\nimport "cube.step" as cube',
      wasmInstance
    )
    const result = addImportOrClone({
      ast,
      path: 'cube.step',
      localName: 'myInstance',
      representation: 'mesh',
      artifactGraph: new Map(),
      wasmInstance,
    })
    if (result instanceof Error) throw result
    const code = recast(result.modifiedAst, wasmInstance)
    expect(code).toContain(
      '@(targetRepresentation = brep)\nimport "cube.step" as cube'
    )
    expect(code).toContain('myInstance = clone(cube)')
    expect(code).not.toContain('targetRepresentation = mesh')
  })

  it('blocks repeat imports without a module alias', () => {
    const ast = assertParse('import "washer.kcl"', wasmInstance)
    const result = addImportOrClone({
      ast,
      path: 'washer.kcl',
      localName: 'myInstance',
      artifactGraph: new Map(),
      wasmInstance,
    })
    expect(result).toEqual(
      new Error(
        'This file must be imported with a module alias to add a clone.'
      )
    )
    expect(recast(ast, wasmInstance)).not.toContain('myInstance')
  })

  it('does not confuse files in different directories', () => {
    const ast = assertParse('import "parts/main.kcl" as washer', wasmInstance)
    expect(findImportedFile(ast, 'other/main.kcl')).toBeUndefined()
    expect(findImportedFile(ast, 'washer.kcl')).toBeUndefined()
  })
})
