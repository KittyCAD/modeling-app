import {
  afterAll,
  assert,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest'
import { updateModelingState } from '@src/lang/modelingWorkflows'
import { deleteSelectionPromise } from '@src/lang/modifyAst/deleteSelection'
import {
  getArtifactFromRange,
  codeRefFromRange,
} from '@src/lang/std/artifactGraph'
import {
  assertParse,
  nodePathFromRange,
  recast,
  type Artifact,
} from '@src/lang/wasm'
import { SKETCH_FILE_VERSION } from '@src/lib/constants'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'

vi.mock(import('@src/lang/modelingWorkflows'), async (importOriginal) => ({
  ...(await importOriginal()),
  updateModelingState: vi.fn(),
}))

let world: Awaited<ReturnType<typeof buildTheWorldAndNoEngineConnection>>
let deleteSketch: MockInstance<typeof world.rustContext.deleteSketch>
let deleteObjects: MockInstance<typeof world.rustContext.deleteObjects>
const sketchApiResult = new Error('Sketch API dispatch reached')

beforeAll(async () => {
  world = await buildTheWorldAndNoEngineConnection()
  deleteSketch = vi
    .spyOn(world.rustContext, 'deleteSketch')
    .mockRejectedValue(sketchApiResult)
  deleteObjects = vi
    .spyOn(world.rustContext, 'deleteObjects')
    .mockRejectedValue(sketchApiResult)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
beforeEach(() => {
  vi.clearAllMocks()
  world.kclManager.artifactGraph = new Map()
})
afterAll(() => {
  vi.restoreAllMocks()
  world.engineCommandManager.tearDown({
    route: 'user-requested',
    initiatedBy: 'client',
  })
})

describe('deleteSelectionPromise', () => {
  it.each([false, true])(
    'deletes the import when an internal sketch shares its code reference (explicit artifact: %s)',
    async (explicitArtifact) => {
      const code =
        '@settings(kclVersion = 2.0)\nimport "part.kcl" as part\nkeep = 12'
      const ast = assertParse(code, world.instance)
      const statement = ast.body[0]
      const codeRef = codeRefFromRange([statement.start, statement.end, 0], ast)
      const nodePath = await nodePathFromRange(
        ast,
        codeRef.range,
        world.instance
      )
      assert(nodePath)
      // The artifact builder maps an imported sketch's codeRef to the import.
      const importedSketch: Artifact = {
        type: 'sketchBlock',
        id: 'imported-sketch',
        sketchId: 1,
        codeRef: { ...codeRef, nodePath },
      }
      world.kclManager.ast = ast
      world.kclManager.artifactGraph.set(importedSketch.id, importedSketch)
      expect(
        getArtifactFromRange(codeRef.range, world.kclManager.artifactGraph)
      ).toBe(importedSketch)
      const selection = explicitArtifact
        ? { codeRef, artifact: importedSketch }
        : { codeRef }
      const beforeSelection = structuredClone(selection)
      const beforeAst = structuredClone(ast)

      const result = await deleteSelectionPromise({
        selection,
        systemDeps: world,
      })

      expect(result).toBeUndefined()
      expect(deleteSketch).not.toHaveBeenCalled()
      expect(deleteObjects).not.toHaveBeenCalled()
      expect(updateModelingState).toHaveBeenCalledOnce()
      const updatedAst = vi.mocked(updateModelingState).mock.calls[0][0]
      expect(recast(updatedAst, world.instance)).toBe(
        recast(
          assertParse('@settings(kclVersion = 2.0)\nkeep = 12', world.instance),
          world.instance
        )
      )
      expect(ast).toEqual(beforeAst)
      expect(selection).toEqual(beforeSelection)
    }
  )

  it.each(['sketchBlock', 'sketchBlockConstraint'] as const)(
    'retains Rust API dispatch for a local %s',
    async (type) => {
      const code = `@settings(kclVersion = 2.0)
s = sketch(on = XY) {
  line1 = line(start = [0, 10], end = [20, 10])
  horizontal(line1)
}`
      const ast = assertParse(code, world.instance)
      const start =
        type === 'sketchBlock'
          ? code.indexOf('sketch(on')
          : code.indexOf('horizontal(')
      const end =
        type === 'sketchBlock'
          ? code.length
          : start + 'horizontal(line1)'.length
      const codeRef = codeRefFromRange([start, end, 0], ast)
      const nodePath = await nodePathFromRange(
        ast,
        codeRef.range,
        world.instance
      )
      assert(nodePath)
      const artifact: Artifact =
        type === 'sketchBlock'
          ? {
              type,
              id: 'local-sketch',
              sketchId: 3,
              codeRef: { ...codeRef, nodePath },
            }
          : {
              type,
              id: 'local-constraint',
              sketchId: 3,
              constraintId: 4,
              constraintType: 'horizontal',
              codeRef: { ...codeRef, nodePath },
            }
      world.kclManager.ast = ast
      world.kclManager.artifactGraph.set(artifact.id, artifact)

      const result = await deleteSelectionPromise({
        selection: { codeRef, artifact },
        systemDeps: world,
      })

      // Backend mutation is stubbed; verify the requested API and original IDs.
      expect(result).toBe(sketchApiResult)
      expect(updateModelingState).not.toHaveBeenCalled()
      if (type === 'sketchBlock') {
        expect(deleteSketch).toHaveBeenCalledWith(
          SKETCH_FILE_VERSION,
          3,
          expect.anything()
        )
        expect(deleteObjects).not.toHaveBeenCalled()
      } else {
        expect(deleteObjects).toHaveBeenCalledWith(
          SKETCH_FILE_VERSION,
          3,
          [4],
          [],
          expect.anything()
        )
        expect(deleteSketch).not.toHaveBeenCalled()
      }
    }
  )

  it('still deletes an ordinary transform through the AST path', async () => {
    const geometry = `@settings(kclVersion = 2.0)
s = sketch(on = XY) {
  line1 = line(start = [0, 10], end = [20, 10])
  line2 = line(start = [20, 10], end = [0, 30])
  line3 = line(start = [0, 30], end = [0, 10])
}
r = region(sketch = s, point = [1, 11])
body = extrude(r, length = 5)
`
    const code = geometry + 'translate(body, x = 1)'
    const ast = assertParse(code, world.instance)
    world.kclManager.ast = ast
    const codeRef = codeRefFromRange([geometry.length, code.length, 0], ast)

    const result = await deleteSelectionPromise({
      selection: { codeRef },
      systemDeps: world,
    })

    expect(result).toBeUndefined()
    expect(deleteSketch).not.toHaveBeenCalled()
    expect(deleteObjects).not.toHaveBeenCalled()
    expect(updateModelingState).toHaveBeenCalledOnce()
    const updatedAst = vi.mocked(updateModelingState).mock.calls[0][0]
    expect(recast(updatedAst, world.instance)).toBe(
      recast(assertParse(geometry, world.instance), world.instance)
    )
  })
})
