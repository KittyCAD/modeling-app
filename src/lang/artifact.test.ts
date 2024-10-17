import { parse, initPromise } from './wasm'
import { enginelessExecutor } from '../lib/testHelpers'

beforeAll(async () => {
  await initPromise
})

describe('testing artifacts', () => {
  // Enable rotations #152
  test('sketch artifacts', async () => {
    const code = `
const mySketch001 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> lineTo([-1.59, -1.54], %)
  |> lineTo([0.46, -5.82], %)
  // |> rx(45, %)`
    const execState = await enginelessExecutor(parse(code))
    // @ts-ignore
    const sketch001 = execState.memory.get('mySketch001')
    expect(sketch001).toEqual({
      type: 'UserVal',
      __meta: [{ sourceRange: [46, 71] }],
      value: {
        type: 'Sketch',
        on: expect.any(Object),
        start: {
          to: [0, 0],
          from: [0, 0],
          tag: null,
          __geoMeta: {
            id: expect.any(String),
            sourceRange: [46, 71],
          },
        },
        value: [
          {
            type: 'ToPoint',
            tag: null,
            to: [-1.59, -1.54],
            from: [0, 0],
            __geoMeta: {
              sourceRange: [77, 102],
              id: expect.any(String),
            },
          },
          {
            type: 'ToPoint',
            to: [0.46, -5.82],
            from: [-1.59, -1.54],
            tag: null,
            __geoMeta: {
              sourceRange: [108, 132],
              id: expect.any(String),
            },
          },
        ],
        id: expect.any(String),
        __meta: [{ sourceRange: [46, 71] }],
      },
    })
  })
  test('extrude artifacts', async () => {
    // Enable rotations #152
    const code = `
const mySketch001 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> lineTo([-1.59, -1.54], %)
  |> lineTo([0.46, -5.82], %)
  // |> rx(45, %)
  |> extrude(2, %)`
    const execState = await enginelessExecutor(parse(code))
    // @ts-ignore
    const sketch001 = execState.memory.get('mySketch001')
    expect(sketch001).toEqual({
      type: 'Solid',
      id: expect.any(String),
      value: [
        {
          type: 'extrudePlane',
          faceId: expect.any(String),
          tag: null,
          id: expect.any(String),
          sourceRange: [77, 102],
        },
        {
          type: 'extrudePlane',
          faceId: expect.any(String),
          tag: null,
          id: expect.any(String),
          sourceRange: [108, 132],
        },
      ],
      sketch: {
        id: expect.any(String),
        __meta: expect.any(Array),
        on: expect.any(Object),
        start: expect.any(Object),
        type: 'Sketch',
        value: [
          {
            type: 'ToPoint',
            from: [0, 0],
            to: [-1.59, -1.54],
            tag: null,
            __geoMeta: {
              id: expect.any(String),
              sourceRange: [77, 102],
            },
          },
          {
            type: 'ToPoint',
            from: [-1.59, -1.54],
            to: [0.46, -5.82],
            tag: null,
            __geoMeta: {
              id: expect.any(String),
              sourceRange: [108, 132],
            },
          },
        ],
      },
      height: 2,
      startCapId: expect.any(String),
      endCapId: expect.any(String),
      __meta: [{ sourceRange: [46, 71] }],
    })
  })
  test('sketch extrude and sketch on one of the faces', async () => {
    // Enable rotations #152
    // TODO #153 in order for getExtrudeWallTransform to work we need to query the engine for the location of a face.
    const code = `
const sk1 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> lineTo([-2.5, 0], %)
  |> lineTo([0, 10], %, $p)
  |> lineTo([2.5, 0], %)
  // |> rx(45, %)
  // |> translate([1,0,1], %)
  // |> ry(5, %)
const theExtrude = extrude(2, sk1)
// const theTransf = getExtrudeWallTransform('p', theExtrude)
const sk2 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> lineTo([-2.5, 0], %)
  |> lineTo([0, 3], %, $o)
  |> lineTo([2.5, 0], %)
  // |> transform(theTransf, %)
  |> extrude(2, %)

`
    const execState = await enginelessExecutor(parse(code))
    const programMemory = execState.memory
    // @ts-ignore
    const geos = [programMemory.get('theExtrude'), programMemory.get('sk2')]
    expect(geos).toEqual([
      {
        type: 'Solid',
        id: expect.any(String),
        value: [
          {
            type: 'extrudePlane',
            faceId: expect.any(String),
            tag: null,
            id: expect.any(String),
            sourceRange: [69, 89],
          },
          {
            type: 'extrudePlane',
            faceId: expect.any(String),
            tag: {
              end: 116,
              start: 114,
              type: 'TagDeclarator',
              value: 'p',
              digest: null,
            },
            id: expect.any(String),
            sourceRange: [95, 117],
          },
          {
            type: 'extrudePlane',
            faceId: expect.any(String),
            tag: null,
            id: expect.any(String),
            sourceRange: [123, 142],
          },
        ],
        sketch: {
          id: expect.any(String),
          __meta: expect.any(Array),
          on: expect.any(Object),
          start: expect.any(Object),
          type: 'Sketch',
          tags: {
            p: {
              __meta: [
                {
                  sourceRange: [114, 116],
                },
              ],
              type: 'TagIdentifier',
              value: 'p',
              info: expect.any(Object),
            },
          },
          value: [
            {
              type: 'ToPoint',
              from: [0, 0],
              to: [-2.5, 0],
              tag: null,
              __geoMeta: {
                id: expect.any(String),
                sourceRange: [69, 89],
              },
            },
            {
              type: 'ToPoint',
              from: [-2.5, 0],
              to: [0, 10],
              tag: {
                end: 116,
                start: 114,
                type: 'TagDeclarator',
                value: 'p',
                digest: null,
              },
              __geoMeta: {
                id: expect.any(String),
                sourceRange: [95, 117],
              },
            },
            {
              type: 'ToPoint',
              from: [0, 10],
              to: [2.5, 0],
              tag: null,
              __geoMeta: {
                id: expect.any(String),
                sourceRange: [123, 142],
              },
            },
          ],
        },
        height: 2,
        startCapId: expect.any(String),
        endCapId: expect.any(String),
        __meta: [{ sourceRange: [38, 63] }],
      },
      {
        type: 'Solid',
        id: expect.any(String),
        value: [
          {
            type: 'extrudePlane',
            faceId: expect.any(String),
            tag: null,
            id: expect.any(String),
            sourceRange: [373, 393],
          },
          {
            type: 'extrudePlane',
            faceId: expect.any(String),
            tag: {
              end: 419,
              start: 417,
              type: 'TagDeclarator',
              value: 'o',
              digest: null,
            },
            id: expect.any(String),
            sourceRange: [399, 420],
          },
          {
            type: 'extrudePlane',
            faceId: expect.any(String),
            tag: null,
            id: expect.any(String),
            sourceRange: [426, 445],
          },
        ],
        sketch: {
          id: expect.any(String),
          __meta: expect.any(Array),
          on: expect.any(Object),
          start: expect.any(Object),
          type: 'Sketch',
          tags: {
            o: {
              __meta: [
                {
                  sourceRange: [417, 419],
                },
              ],
              type: 'TagIdentifier',
              value: 'o',
              info: expect.any(Object),
            },
          },
          value: [
            {
              type: 'ToPoint',
              from: [0, 0],
              to: [-2.5, 0],
              tag: null,
              __geoMeta: {
                id: expect.any(String),
                sourceRange: [373, 393],
              },
            },
            {
              type: 'ToPoint',
              from: [-2.5, 0],
              to: [0, 3],
              tag: {
                end: 419,
                start: 417,
                type: 'TagDeclarator',
                value: 'o',
                digest: null,
              },
              __geoMeta: {
                id: expect.any(String),
                sourceRange: [399, 420],
              },
            },
            {
              type: 'ToPoint',
              from: [0, 3],
              to: [2.5, 0],
              tag: null,
              __geoMeta: {
                id: expect.any(String),
                sourceRange: [426, 445],
              },
            },
          ],
        },
        height: 2,
        startCapId: expect.any(String),
        endCapId: expect.any(String),
        __meta: [{ sourceRange: [342, 367] }],
      },
    ])
  })
})
