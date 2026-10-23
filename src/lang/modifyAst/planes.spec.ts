import {
  addConstructionPlane,
  addReferencePlane,
} from '@src/lang/modifyAst/planes'
import type { KclManager } from '@src/lang/KclManager'
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
import type { Selections } from '@src/machines/modelingSharedTypes'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { beforeAll, describe, expect, it, vi } from 'vitest'

let world: Awaited<ReturnType<typeof buildTheWorldAndNoEngineConnection>>
beforeAll(async () => {
  world = await buildTheWorldAndNoEngineConnection()
})

describe('construction planes', () => {
  it.each(['midplane', 'parallel', 'bisector', 'offset'] as const)(
    'creates a sketchable %s from selected references in inch projects',
    async (kind) => {
      const ast = assertParse(
        `@settings(kclVersion = 3.0, defaultLengthUnit = in)
p0 = plane(origin = [0mm, 0mm, 0mm], normal = [0, 0, 1], xAxis = [1, 0, 0])
p40 = plane(origin = [0mm, 0mm, 40mm], normal = [0, 0, -1], xAxis = [1, 0, 0])`,
        world.instance
      )
      const execution = await enginelessExecutor(ast, world.rustContext)
      const plane = (name: string) => {
        const value = execution.variables[name]
        if (value?.type !== 'Plane') throw new Error('Missing source plane')
        return {
          entityRef: {
            type: 'plane' as const,
            plane_id: value.value.artifactId,
          },
        }
      }
      const point = (z: number) => ({
        entityRef: { type: 'vertex' as const, side_faces: [] },
        vertexPosition: [0, 0, z] as [number, number, number],
      })
      const references: Selections = {
        otherSelections: [],
        graphSelections:
          kind === 'midplane'
            ? [plane('p0'), plane('p40')]
            : kind === 'parallel'
              ? [point(20), plane('p0')]
              : kind === 'bisector'
                ? [point(0), point(40)]
                : [plane('p0')],
      }
      const offset = await stringToKclExpression('20mm', world.rustContext)
      if (isErr(offset) || 'errors' in offset) throw new Error('Invalid offset')
      const sendSceneCommand = vi.fn().mockResolvedValue(null)
      const kclManager = {
        ast,
        artifactGraph: execution.artifactGraph,
        variables: execution.variables,
        engineCommandManager: { sendSceneCommand },
        sceneInfra: { baseUnitMultiplier: 25.4 },
      } as unknown as KclManager
      const result = await addReferencePlane({
        ast,
        wasmInstance: world.instance,
        kclManager,
        references,
        offset,
      })
      if (isErr(result)) throw result
      const code = recast(result.modifiedAst, world.instance)
      if (isErr(code)) throw code
      const next = await enginelessExecutor(
        assertParse(`${code}\ns = sketch(on = plane001) {}`, world.instance),
        world.rustContext
      )
      const value = next.variables.plane001
      if (value?.type !== 'Plane') throw new Error('Missing reference plane')
      expect(value.value.origin).toMatchObject({
        x: 0,
        y: 0,
        z: 20,
        units: 'mm',
      })
      expect(value.value.zAxis.z).toBeCloseTo(1)
      expect(sendSceneCommand).not.toHaveBeenCalled()
      expect(recast(ast, world.instance)).not.toContain('plane001')
    }
  )
  it('writes picked corners with explicit millimeters, independent of project units', async () => {
    const ast = assertParse(
      '@settings(kclVersion = 3.0, defaultLengthUnit = in)',
      world.instance
    )
    const pickedPoints: Selections = {
      otherSelections: [],
      graphSelections: [
        [25.4, 0, 20],
        [35.4, 0, 20],
        [25.4, 10, 30],
      ].map((point, i) => ({
        entityRef: { type: 'vertex', side_faces: [`face${i}`] },
        vertexPosition: point as [number, number, number],
      })),
    }
    const result = addConstructionPlane({
      ast,
      wasmInstance: world.instance,
      method: 'Points',
      pointSource: 'Pick',
      pickedPoints,
    })
    if (isErr(result)) throw result
    const code = recast(result.modifiedAst, world.instance)
    if (isErr(code)) throw code
    expect(code.replaceAll(/\s/g, '')).toContain(
      '[[25.4mm,0mm,20mm],[35.4mm,0mm,20mm],[25.4mm,10mm,30mm]]'
    )
    const execution = await enginelessExecutor(
      assertParse(`${code}\ns = sketch(on = plane001) {}`, world.instance),
      world.rustContext
    )
    const sketch = [...execution.artifactGraph.values()].find(
      (a) => a.type === 'sketchBlock'
    )
    if (sketch?.type !== 'sketchBlock') throw new Error('Missing sketch')
    expect(sketch.planeInfo?.origin).toMatchObject({ x: 25.4, y: 0, z: 20 })
    const invalid = {
      ...pickedPoints,
      graphSelections: pickedPoints.graphSelections.slice(0, 2),
    }
    expect(
      addConstructionPlane({
        ast,
        wasmInstance: world.instance,
        method: 'Points',
        pointSource: 'Pick',
        pickedPoints: invalid,
      })
    ).toBeInstanceOf(Error)
    expect(recast(ast, world.instance)).not.toContain('plane001')
  })
  it.each([
    'origin = [0mm, 0mm, 20mm], xAxis = [2, 0, 0], yAxis = [0, 3, 0]',
    'origin = [0mm, 0mm, 20mm], normal = [0, 0, 1], xAxis = [1, 0, 4]',
    'points = [[0mm, 0mm, 20mm], [10mm, 0mm, 20mm], [0mm, 10mm, 20mm]]',
    'a = 0, b = 0, c = 2, d = -40mm, xAxis = [1, 0, 0]',
  ])(
    'returns a selectable typed plane and supports a sketch: %s',
    async (args) => {
      const code = `@settings(kclVersion = 3.0)
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
      '@settings(kclVersion = 3.0)\np = plane(origin = [1in, 2cm, 30mm], normal = [0, 0, 1], xAxis = [1, 0, 0])\ns = sketch(on = p) {}'
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
