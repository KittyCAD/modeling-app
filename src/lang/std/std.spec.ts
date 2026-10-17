import type { KclManager } from '@src/lang/KclManager'
import { assertParse } from '@src/lang/wasm'
import type RustContext from '@src/lib/rustContext'
import {
  enginelessExecutor,
  getAstAndArtifactGraph,
} from '@src/lib/testHelpers'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

let instanceInThisFile: ModuleType = null!
let kclManagerInThisFile: KclManager = null!
let engineCommandManagerInThisFile: ConnectionManager = null!
let rustContextInThisFile: RustContext = null!

/**
 * Every it test could build the world and connect to the engine but this is too resource intensive and will
 * spam engine connections.
 *
 * Reuse the world for this file. This is not the same as global singleton imports!
 */
beforeEach(async () => {
  if (instanceInThisFile) {
    return
  }

  const { instance, kclManager, engineCommandManager, rustContext } =
    await buildTheWorldAndConnectToEngine({ webrtc: false, pool: 'cpu' })
  instanceInThisFile = instance
  kclManagerInThisFile = kclManager
  engineCommandManagerInThisFile = engineCommandManager
  rustContextInThisFile = rustContext
})

afterAll(() => {
  engineCommandManagerInThisFile.tearDown({
    route: 'user-requested',
    initiatedBy: 'client',
  })
})

describe('testing angledLineThatIntersects', () => {
  it('angledLineThatIntersects should intersect with another line', async () => {
    const code = (offset: string) => `part001 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [2, 2], tag = $yo)
  |> line(endAbsolute = [3, 1])
  |> angledLineThatIntersects(
       angle = 180deg,
       intersectTag = yo,
       offset = ${offset},
       tag = $yo2,
     )
intersect = segEndX(yo2)`
    const execState = await enginelessExecutor(
      assertParse(code('-1'), instanceInThisFile),
      rustContextInThisFile
    )
    const intersect = execState.variables['intersect']
    expect(intersect?.type).toBe('Number')
    if (intersect?.type !== 'Number') {
      throw new Error('Expected KCL value Number')
    }
    expect(intersect.value).toBe(1 + Math.sqrt(2))
    const noOffset = await enginelessExecutor(
      assertParse(code('0'), instanceInThisFile),
      rustContextInThisFile
    )
    const noOffsetIntersect = noOffset.variables['intersect']
    expect(noOffsetIntersect?.type).toBe('Number')
    if (noOffsetIntersect?.type !== 'Number') {
      throw new Error('Expected KCL value Number')
    }
    expect(noOffsetIntersect.value).toBeCloseTo(1)
  })
})

describe('planarSurface', () => {
  it.each([
    {
      name: 'a mirrored sketch',
      transform: 'transformed = mirror2d(sketch001, axis = Y)',
      centerX: -2,
      requiresRegion: true,
    },
    {
      name: 'a pattern copy',
      transform: `copies = patternLinear2d(sketch001, instances = 2, distance = 10mm, axis = [1, 0])
transformed = copies[1]`,
      centerX: 12,
      requiresRegion: true,
    },
    {
      name: 'a mirrored region',
      transform: `selected = region(segments = [sketch001.bottom, sketch001.right])
transformed = mirror2d(selected, axis = Y)`,
      centerX: -2,
      requiresRegion: false,
    },
    {
      name: 'a patterned region',
      transform: `selected = region(segments = [sketch001.bottom, sketch001.right])
copies = patternLinear2d(selected, instances = 2, distance = 10mm, axis = [1, 0])
transformed = copies[1]`,
      centerX: 12,
      requiresRegion: false,
    },
  ])(
    'preserves the surface position or requests a region for $name',
    async ({ transform, centerX, requiresRegion }) => {
      const boundary = [
        'bottom = line(start = [1mm, 1mm], end = [3mm, 1mm])',
        'right = line(start = [3mm, 1mm], end = [3mm, 3mm])',
        'top = line(start = [3mm, 3mm], end = [1mm, 3mm])',
        'left = line(start = [1mm, 3mm], end = [1mm, 1mm])',
      ]
      for (const order of [
        [0, 1, 2, 3],
        [0, 2, 1, 3],
      ]) {
        const { artifactGraph } = await getAstAndArtifactGraph(
          `@settings(kclVersion = 2.0, experimentalFeatures = allow)
sketch001 = sketch(on = XY) {
  ${order.map((index) => boundary[index]).join('\n  ')}
}
${transform}
surface001 = planarSurface(transformed)`,
          instanceInThisFile,
          kclManagerInThisFile
        )
        if (requiresRegion && order[1] === 2) {
          expect(kclManagerInThisFile.errors).toHaveLength(1)
          expect(kclManagerInThisFile.errors[0].message).toContain(
            'Select its boundary with `region(...)` before applying the transform'
          )
          expect(
            [...artifactGraph.values()].some(
              (artifact) =>
                artifact.type === 'sweep' &&
                artifact.subType === 'planarSurface'
            )
          ).toBe(false)
          continue
        }
        expect(kclManagerInThisFile.errors).toEqual([])
        const surface = [...artifactGraph.values()].find(
          (artifact) =>
            artifact.type === 'sweep' && artifact.subType === 'planarSurface'
        )
        if (!surface) throw new Error('Missing Planar Surface')
        const boundingBox =
          await engineCommandManagerInThisFile.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: crypto.randomUUID(),
            cmd: {
              type: 'bounding_box',
              entity_ids: [surface.id],
              output_unit: 'mm',
            },
          })
        expect(boundingBox).toMatchObject({
          success: true,
          resp: {
            data: {
              modeling_response: {
                type: 'bounding_box',
                data: {
                  center: {
                    x: expect.closeTo(centerX, 8),
                    y: expect.closeTo(2, 8),
                    z: expect.closeTo(0, 8),
                  },
                  dimensions: {
                    x: expect.closeTo(2, 8),
                    y: expect.closeTo(2, 8),
                    z: expect.closeTo(0, 8),
                  },
                },
              },
            },
          },
        })
      }
    }
  )
})
