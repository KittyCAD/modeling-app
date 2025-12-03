import { assertParse } from '@src/lang/wasm'
import { enginelessExecutor } from '@src/lib/testHelpers'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { ConnectionManager } from '@src/network/connectionManager'
import type RustContext from '@src/lib/rustContext'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import { afterAll, expect, beforeEach, describe, test } from 'vitest'

let instanceInThisFile: ModuleType = null!
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

  const { instance, engineCommandManager, rustContext } =
    await buildTheWorldAndConnectToEngine()
  instanceInThisFile = instance
  engineCommandManagerInThisFile = engineCommandManager
  rustContextInThisFile = rustContext
})

afterAll(() => {
  engineCommandManagerInThisFile.tearDown()
})

describe('testing artifacts', () => {
  // Enable rotations #152
  test('sketch artifacts', async () => {
    const code = `
mySketch001 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [-1.59, -1.54])
  |> line(endAbsolute = [0.46, -5.82])
  // |> rx(45)`
    const execState = await enginelessExecutor(
      assertParse(code, instanceInThisFile),
      undefined,
      undefined,
      rustContextInThisFile
    )
    const sketch001 = execState.variables['mySketch001']
    expect(sketch001).toEqual({
      type: 'Sketch',
      value: {
        type: 'Sketch',
        on: expect.any(Object),
        start: {
          to: [0, 0],
          from: [0, 0],
          units: 'mm',
          tag: null,
          __geoMeta: {
            id: expect.any(String),
            sourceRange: [expect.any(Number), expect.any(Number), 0],
          },
        },
        paths: [
          {
            type: 'ToPoint',
            tag: null,
            to: [-1.59, -1.54],
            units: 'mm',
            from: [0, 0],
            __geoMeta: {
              sourceRange: [expect.any(Number), expect.any(Number), 0],
              id: expect.any(String),
            },
          },
          {
            type: 'ToPoint',
            to: [0.46, -5.82],
            from: [-1.59, -1.54],
            units: 'mm',
            tag: null,
            __geoMeta: {
              sourceRange: [expect.any(Number), expect.any(Number), 0],
              id: expect.any(String),
            },
          },
        ],
        id: expect.any(String),
        artifactId: expect.any(String),
        isClosed: false,
        originalId: expect.any(String),
        units: 'mm',
      },
    })
  })
  test('extrude artifacts', async () => {
    // Enable rotations #152
    const code = `
mySketch001 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [-1.59, -1.54])
  |> line(endAbsolute = [0.46, -5.82])
  // |> rx(45)
  |> extrude(length = 2)`
    const execState = await enginelessExecutor(
      assertParse(code, instanceInThisFile),
      undefined,
      undefined,
      rustContextInThisFile
    )
    const sketch001 = execState.variables['mySketch001']
    expect(sketch001).toEqual({
      type: 'Solid',
      value: {
        type: 'Solid',
        id: expect.any(String),
        artifactId: expect.any(String),
        value: [
          {
            type: 'extrudePlane',
            faceId: expect.any(String),
            tag: null,
            id: expect.any(String),
            sourceRange: [expect.any(Number), expect.any(Number), 0],
          },
          {
            type: 'extrudePlane',
            faceId: expect.any(String),
            tag: null,
            id: expect.any(String),
            sourceRange: [expect.any(Number), expect.any(Number), 0],
          },
        ],
        sketch: {
          id: expect.any(String),
          originalId: expect.any(String),
          artifactId: expect.any(String),
          units: 'mm',
          on: expect.any(Object),
          start: expect.any(Object),
          type: 'Sketch',
          paths: [
            {
              type: 'ToPoint',
              from: [0, 0],
              to: [-1.59, -1.54],
              units: 'mm',
              tag: null,
              __geoMeta: {
                id: expect.any(String),
                sourceRange: [expect.any(Number), expect.any(Number), 0],
              },
            },
            {
              type: 'ToPoint',
              from: [-1.59, -1.54],
              to: [0.46, -5.82],
              units: 'mm',
              tag: null,
              __geoMeta: {
                id: expect.any(String),
                sourceRange: [expect.any(Number), expect.any(Number), 0],
              },
            },
          ],
        },
        sectional: false,
        startCapId: expect.any(String),
        endCapId: expect.any(String),
        units: 'mm',
      },
    })
  })
  test('sketch extrude and sketch on one of the faces', async () => {
    // Enable rotations #152
    // TODO #153 in order for getExtrudeWallTransform to work we need to query the engine for the location of a face.
    const code = `
sk1 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [-2.5, 0])
  |> line(endAbsolute = [0, 10], tag = $p)
  |> line(endAbsolute = [2.5, 0])
  // |> rx(45)
  // |> translate(x = 1, y = 0, z = 1)
  // |> ry(5)
theExtrude = extrude(sk1, length = 2)
// theTransf = getExtrudeWallTransform('p', theExtrude)
sk2 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [-2.5, 0])
  |> line(endAbsolute = [0, 3], tag = $o)
  |> line(endAbsolute = [2.5, 0])
  // |> transform(theTransf)
  |> extrude(length = 2)

`
    const execState = await enginelessExecutor(
      assertParse(code, instanceInThisFile),
      undefined,
      undefined,
      rustContextInThisFile
    )
    const variables = execState.variables
    // @ts-ignore
    const geos = [variables['theExtrude'], variables['sk2']]
    expect(geos).toEqual([
      {
        type: 'Solid',
        value: {
          type: 'Solid',
          id: expect.any(String),
          artifactId: expect.any(String),
          value: [
            {
              type: 'extrudePlane',
              faceId: expect.any(String),
              tag: null,
              id: expect.any(String),
              sourceRange: [expect.any(Number), expect.any(Number), 0],
            },
            {
              type: 'extrudePlane',
              faceId: expect.any(String),
              tag: {
                end: 132,
                start: 130,
                moduleId: expect.any(Number),
                commentStart: expect.any(Number),
                type: 'TagDeclarator',
                value: 'p',
              },
              id: expect.any(String),
              sourceRange: [expect.any(Number), expect.any(Number), 0],
            },
            {
              type: 'extrudePlane',
              faceId: expect.any(String),
              tag: null,
              id: expect.any(String),
              sourceRange: [expect.any(Number), expect.any(Number), 0],
            },
          ],
          sketch: {
            id: expect.any(String),
            originalId: expect.any(String),
            artifactId: expect.any(String),
            on: expect.any(Object),
            start: expect.any(Object),
            type: 'Sketch',
            units: 'mm',
            tags: {
              p: {
                type: 'TagIdentifier',
                value: 'p',
              },
            },
            paths: [
              {
                type: 'ToPoint',
                from: [0, 0],
                to: [-2.5, 0],
                units: 'mm',
                tag: null,
                __geoMeta: {
                  id: expect.any(String),
                  sourceRange: [expect.any(Number), expect.any(Number), 0],
                },
              },
              {
                type: 'ToPoint',
                from: [-2.5, 0],
                to: [0, 10],
                units: 'mm',
                tag: {
                  end: expect.any(Number),
                  start: expect.any(Number),
                  moduleId: expect.any(Number),
                  commentStart: expect.any(Number),
                  type: 'TagDeclarator',
                  value: 'p',
                },
                __geoMeta: {
                  id: expect.any(String),
                  sourceRange: [expect.any(Number), expect.any(Number), 0],
                },
              },
              {
                type: 'ToPoint',
                from: [0, 10],
                to: [2.5, 0],
                units: 'mm',
                tag: null,
                __geoMeta: {
                  id: expect.any(String),
                  sourceRange: [expect.any(Number), expect.any(Number), 0],
                },
              },
            ],
          },
          sectional: false,
          startCapId: expect.any(String),
          endCapId: expect.any(String),
          units: 'mm',
        },
      },
      {
        type: 'Solid',
        value: {
          type: 'Solid',
          id: expect.any(String),
          artifactId: expect.any(String),
          value: [
            {
              type: 'extrudePlane',
              faceId: expect.any(String),
              tag: null,
              id: expect.any(String),
              sourceRange: [expect.any(Number), expect.any(Number), 0],
            },
            {
              type: 'extrudePlane',
              faceId: expect.any(String),
              tag: {
                end: expect.any(Number),
                start: expect.any(Number),
                moduleId: expect.any(Number),
                commentStart: expect.any(Number),
                type: 'TagDeclarator',
                value: 'o',
              },
              id: expect.any(String),
              sourceRange: [expect.any(Number), expect.any(Number), 0],
            },
            {
              type: 'extrudePlane',
              faceId: expect.any(String),
              tag: null,
              id: expect.any(String),
              sourceRange: [expect.any(Number), expect.any(Number), 0],
            },
          ],
          sketch: {
            id: expect.any(String),
            originalId: expect.any(String),
            artifactId: expect.any(String),
            units: 'mm',
            on: expect.any(Object),
            start: expect.any(Object),
            type: 'Sketch',
            tags: {
              o: {
                type: 'TagIdentifier',
                value: 'o',
              },
            },
            paths: [
              {
                type: 'ToPoint',
                from: [0, 0],
                to: [-2.5, 0],
                units: 'mm',
                tag: null,
                __geoMeta: {
                  id: expect.any(String),
                  sourceRange: [expect.any(Number), expect.any(Number), 0],
                },
              },
              {
                type: 'ToPoint',
                from: [-2.5, 0],
                to: [0, 3],
                units: 'mm',
                tag: {
                  end: expect.any(Number),
                  start: expect.any(Number),
                  moduleId: expect.any(Number),
                  commentStart: expect.any(Number),
                  type: 'TagDeclarator',
                  value: 'o',
                },
                __geoMeta: {
                  id: expect.any(String),
                  sourceRange: [expect.any(Number), expect.any(Number), 0],
                },
              },
              {
                type: 'ToPoint',
                from: [0, 3],
                to: [2.5, 0],
                units: 'mm',
                tag: null,
                __geoMeta: {
                  id: expect.any(String),
                  sourceRange: [expect.any(Number), expect.any(Number), 0],
                },
              },
            ],
          },
          sectional: false,
          startCapId: expect.any(String),
          endCapId: expect.any(String),
          units: 'mm',
        },
      },
    ])
  })
})
