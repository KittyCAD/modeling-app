import { join } from 'path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KclManager } from '@src/lang/KclManager'
import { updateModelingState } from '@src/lang/modelingWorkflows'
import { addAppearance } from '@src/lang/modifyAst/transforms'
import { findImportNodeAndAlias } from '@src/lang/queryAst'
import type { Artifact, SourceRange } from '@src/lang/wasm'
import {
  assertParse,
  nodePathFromRange,
  pathToNodeFromRustNodePath,
  recast,
} from '@src/lang/wasm'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import { EXECUTION_TYPE_REAL } from '@src/lib/constants'
import {
  type HideOperation,
  getOperationVariableName,
  onUnhide,
} from '@src/lib/operations'
import { isErr } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

vi.mock('@src/lang/modelingWorkflows', () => ({
  updateModelingState: vi.fn(),
}))

let wasmInstance: ModuleType
beforeAll(async () => {
  wasmInstance = await loadAndInitialiseWasmInstance(
    join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')
  )
})
beforeEach(() => {
  vi.clearAllMocks()
})

async function importSelection(code: string, importIndex = 0) {
  const ast = assertParse(code, wasmInstance)
  const statement = ast.body[importIndex]
  const range: SourceRange = [statement.start, statement.end, 0]
  const nodePath = await nodePathFromRange(ast, range, wasmInstance)
  if (!nodePath) throw new Error('Missing import node path')
  const codeRef = {
    range,
    nodePath,
    pathToNode: pathToNodeFromRustNodePath(nodePath),
  }
  const artifact: Artifact = {
    type: 'importedGeometry',
    id: `part-${importIndex}`,
    consumed: false,
    codeRef,
  }
  return {
    ast,
    artifact,
    artifactGraph: new Map([[artifact.id, artifact]]),
    selection: {
      graphSelections: [{ artifact, codeRef }],
      otherSelections: [],
    },
  }
}

describe('imported geometry actions', () => {
  it.each([
    ['import "part.step"', 'part'],
    ['import "parts/part.step"', 'part'],
    ['import "parts/part.step" as importedPart', 'importedPart'],
  ])('adds Appearance for %s', async (importStatement, name) => {
    const { ast, artifact, artifactGraph, selection } = await importSelection(
      `@settings(kclVersion = 2.0)\n${importStatement}\n`
    )
    const result = addAppearance({
      ast,
      artifactGraph,
      objects: selection,
      color: '#ff0000',
      wasmInstance,
    })
    if (isErr(result)) throw result

    expect(recast(result.modifiedAst, wasmInstance)).toContain(
      `appearance(${name}, color = "#ff0000")`
    )
    expect(
      getOperationVariableName(
        {
          type: 'ImportedGeometry',
          name,
          moduleId: 1,
          nodePath: artifact.codeRef.nodePath,
          sourceRange: artifact.codeRef.range,
        },
        ast,
        wasmInstance
      )
    ).toBe(name)
  })

  it.each([
    ['import "partA.step"', 'import "partB.step"'],
    ['import "a.step" as partA', 'import "b.step" as partB'],
  ])('unhides one import from a grouped hide: %s', async (first, second) => {
    for (const importIndex of [0, 1]) {
      const { ast, artifact } = await importSelection(
        `@settings(kclVersion = 2.0)\n${first}\n${second}\nhide([partA, partB])\n`,
        importIndex
      )
      const statement = ast.body[2]
      const range: SourceRange = [statement.start, statement.end, 0]
      const nodePath = await nodePathFromRange(ast, range, wasmInstance)
      if (!nodePath) throw new Error('Missing hide node path')
      const hideOperation: HideOperation = {
        type: 'StdLibCall',
        name: 'hide',
        sourceRange: range,
        nodePath,
        isError: false,
        labeledArgs: {},
        unlabeledArg: {
          sourceRange: range,
          value: {
            type: 'Array',
            value: [
              { type: 'ImportedGeometry', artifact_id: 'part-0' },
              { type: 'ImportedGeometry', artifact_id: 'part-1' },
            ],
          },
        },
      }
      const kclManager = {
        ast,
        rustContext: { wasmInstancePromise: Promise.resolve(wasmInstance) },
      } as KclManager

      const result = await onUnhide({
        hideOperation,
        targetArtifact: artifact,
        kclManager,
      })
      if (isErr(result)) throw result

      expect(updateModelingState).toHaveBeenLastCalledWith(
        expect.anything(),
        EXECUTION_TYPE_REAL,
        kclManager,
        { focusPath: [] }
      )
      const modifiedAst = vi.mocked(updateModelingState).mock.lastCall?.[0]
      if (!modifiedAst) throw new Error('Missing updated AST')
      expect(recast(modifiedAst, wasmInstance)).toBe(
        `@settings(kclVersion = 2.0)\n\n${first}\n${second}\nhide([${importIndex === 0 ? 'partB' : 'partA'}])\n`
      )
      expect(recast(ast, wasmInstance)).toContain('hide([partA, partB])')
    }
  })
})

describe('inferred import names', () => {
  it.each([
    ['import "part.kcl"', 'part'],
    ['import "parts/part/main.kcl"', 'part'],
    ['import "parts/part/main.kcl" as explicitName', 'explicitName'],
  ])('resolves %s', async (importStatement, name) => {
    const { ast, artifact } = await importSelection(
      `@settings(kclVersion = 2.0)\n${importStatement}\n`
    )
    expect(
      findImportNodeAndAlias(ast, artifact.codeRef.pathToNode, wasmInstance)
        ?.alias
    ).toBe(name)
  })
})
