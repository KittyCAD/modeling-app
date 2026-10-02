import { addConstructionPlane } from '@src/lang/modifyAst/planes'
import { findOperationPlaneArtifact, isOffsetPlane } from '@src/lang/queryAst'
import {
  assertParse,
  getAllOperations,
  recast,
  pathToNodeFromRustNodePath,
} from '@src/lang/wasm'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import { isErr } from '@src/lib/trap'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { beforeAll, describe, expect, it } from 'vitest'

let world: Awaited<ReturnType<typeof buildTheWorldAndNoEngineConnection>>
beforeAll(async () => {
  world = await buildTheWorldAndNoEngineConnection()
})

describe('construction planes', () => {
  it.each([
    'origin = [0mm, 0mm, 20mm], xAxis = [2, 0, 0], yAxis = [0, 3, 0]',
    'origin = [0mm, 0mm, 20mm], normal = [0, 0, 1], xAxis = [1, 0, 4]',
    'points = [[0mm, 0mm, 20mm], [10mm, 0mm, 20mm], [0mm, 10mm, 20mm]]',
    'a = 0, b = 0, c = 2, d = -40mm, xAxis = [1, 0, 0]',
  ])(
    'returns a selectable typed plane and supports a sketch: %s',
    async (args) => {
      const code = `@settings(kclVersion = 2.0)
p = plane(${args})
s = sketch(on = p) { edge = line(start = [0mm, 0mm], end = [10mm, 0mm]) }`
      const result = await enginelessExecutor(
        assertParse(code, world.instance),
        world.rustContext
      )
      expect(result.variables.p?.type).toBe('Plane')
      const op = getAllOperations(result.operations).find(
        (op) => op.type === 'StdLibCall' && op.name === 'plane'
      )
      expect(op).toBeDefined()
      if (!op || !isOffsetPlane(op)) throw new Error('Missing plane operation')
      expect(findOperationPlaneArtifact(op, result.artifactGraph)?.type).toBe(
        'plane'
      )
      const sketch = [...result.artifactGraph.values()].find(
        (a) => a.type === 'sketchBlock'
      )
      if (sketch?.type !== 'sketchBlock') throw new Error('Missing sketch')
      expect(sketch.planeInfo?.origin).toMatchObject({ x: 0, y: 0, z: 20 })
      expect(sketch.planeInfo?.xAxis).toMatchObject({ x: 1, y: 0, z: 0 })
      expect(sketch.planeInfo?.yAxis).toMatchObject({ x: 0, y: 1, z: 0 })
    }
  )

  it.each([
    ['normal = [0, 0, 0], origin = [0, 0, 0], xAxis = [1, 0, 0]', 'nonzero'],
    ['normal = [0, 0, 1], origin = [0, 0, 0], xAxis = [0, 0, 1]', 'parallel'],
    ['points = [[1, 2, 3], [2, 3, 4], [4, 5, 6]]', 'collinear'],
    [
      'origin = [0, 0, 0], normal = [0, 0, 1], xAxis = [1, 0, 0], yAxis = [0, 1, 0]',
      'Choose one',
    ],
    ['a = 0, b = 0, c = 1, xAxis = [1, 0, 0]', 'Choose one'],
  ])(
    'rejects invalid input before creating an artifact: %s',
    async (args, message) => {
      await expect(
        enginelessExecutor(
          assertParse(`p = plane(${args})`, world.instance),
          world.rustContext
        )
      ).rejects.toThrow(message)
    }
  )

  it('converts mixed explicit length units', async () => {
    const code =
      '@settings(kclVersion = 2.0)\np = plane(origin = [1in, 2cm, 30mm], normal = [0, 0, 1], xAxis = [1, 0, 0])\ns = sketch(on = p) {}'
    const result = await enginelessExecutor(
      assertParse(code, world.instance),
      world.rustContext
    )
    const sketch = [...result.artifactGraph.values()].find(
      (a) => a.type === 'sketchBlock'
    )
    if (sketch?.type !== 'sketchBlock') throw new Error('Missing sketch')
    expect(sketch.planeInfo?.origin).toMatchObject({ x: 25.4, y: 20, z: 30 })
  })

  it('switches methods on edit without retaining incompatible arguments', async () => {
    const code =
      'height = 20mm\np = plane(origin = [0mm, 0mm, height], normal = [0, 0, 1], xAxis = [1, 0, 0])'
    const ast = assertParse(code, world.instance)
    const result = await enginelessExecutor(ast, world.rustContext)
    const op = getAllOperations(result.operations).find(
      (op) => op.type === 'StdLibCall' && op.name === 'plane'
    )
    if (op?.type !== 'StdLibCall') throw new Error('Missing plane operation')
    const points = await stringToKclExpression(
      '[[0, 0, height], [10, 0, height], [0, 10, height]]',
      world.rustContext,
      { allowArrays: true, allowNestedArrays: true }
    )
    if (isErr(points) || 'errors' in points)
      throw new Error('Invalid points expression')
    const edit = addConstructionPlane({
      ast,
      wasmInstance: world.instance,
      method: 'Points',
      points,
      nodeToEdit: pathToNodeFromRustNodePath(op.nodePath),
    })
    if (isErr(edit)) throw edit
    const editedCode = recast(edit.modifiedAst, world.instance)
    if (isErr(editedCode)) throw editedCode
    expect(editedCode).toContain('height = 20mm')
    expect(editedCode).toContain('p = plane(points =')
    expect(editedCode).not.toContain('normal =')
    expect(editedCode).not.toContain('xAxis =')
    await enginelessExecutor(
      assertParse(editedCode, world.instance),
      world.rustContext
    )
  })
})
