import { assertParse, initPromise } from './wasm'
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
  |> line(endAbsolute = [-1.59, -1.54])
  |> line(endAbsolute = [0.46, -5.82])
  // |> rx(45, %)`
    const execState = await enginelessExecutor(assertParse(code))
    const sketch001 = execState.variables['mySketch001']
    expect(sketch001).toEqual({
      type: 'Sketch',
      value: {
        type: 'Sketch',
        on: expect.any(Object),
        start: {
          to: [0, 0],
          from: [0, 0],
          units: { type: 'Mm' },
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
            units: { type: 'Mm' },
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
            units: { type: 'Mm' },
            tag: null,
            __geoMeta: {
              sourceRange: [expect.any(Number), expect.any(Number), 0],
              id: expect.any(String),
            },
          },
        ],
        id: expect.any(String),
        artifactId: expect.any(String),
        originalId: expect.any(String),
        units: {
          type: 'Mm',
        },
      },
    })
  })
  test('extrude artifacts', async () => {
    // Enable rotations #152
    const code = `
const mySketch001 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line(endAbsolute = [-1.59, -1.54])
  |> line(endAbsolute = [0.46, -5.82])
  // |> rx(45, %)
  |> extrude(length = 2)`
    const execState = await enginelessExecutor(assertParse(code))
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
          units: {
            type: 'Mm',
          },
          on: expect.any(Object),
          start: expect.any(Object),
          type: 'Sketch',
          paths: [
            {
              type: 'ToPoint',
              from: [0, 0],
              to: [-1.59, -1.54],
              units: { type: 'Mm' },
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
              units: { type: 'Mm' },
              tag: null,
              __geoMeta: {
                id: expect.any(String),
                sourceRange: [expect.any(Number), expect.any(Number), 0],
              },
            },
          ],
        },
        height: 2,
        startCapId: expect.any(String),
        endCapId: expect.any(String),
        units: {
          type: 'Mm',
        },
      },
    })
  })
  test('sketch extrude and sketch on one of the faces', async () => {
    // Enable rotations #152
    // TODO #153 in order for getExtrudeWallTransform to work we need to query the engine for the location of a face.
    const code = `
const sk1 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line(endAbsolute = [-2.5, 0])
  |> line(endAbsolute = [0, 10], tag = $p)
  |> line(endAbsolute = [2.5, 0])
  // |> rx(45, %)
  // |> translate([1,0,1], %)
  // |> ry(5, %)
const theExtrude = extrude(sk1, length = 2)
// const theTransf = getExtrudeWallTransform('p', theExtrude)
const sk2 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line(endAbsolute = [-2.5, 0])
  |> line(endAbsolute = [0, 3], tag = $o)
  |> line(endAbsolute = [2.5, 0])
  // |> transform(theTransf, %)
  |> extrude(length = 2)

`
    const execState = await enginelessExecutor(assertParse(code))
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
                end: 140,
                start: 138,
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
            units: {
              type: 'Mm',
            },
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
                units: { type: 'Mm' },
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
                units: { type: 'Mm' },
                tag: {
                  end: expect.any(Number),
                  start: expect.any(Number),
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
                units: { type: 'Mm' },
                tag: null,
                __geoMeta: {
                  id: expect.any(String),
                  sourceRange: [expect.any(Number), expect.any(Number), 0],
                },
              },
            ],
          },
          height: 2,
          startCapId: expect.any(String),
          endCapId: expect.any(String),
          units: {
            type: 'Mm',
          },
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
            units: {
              type: 'Mm',
            },
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
                units: { type: 'Mm' },
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
                units: { type: 'Mm' },
                tag: {
                  end: expect.any(Number),
                  start: expect.any(Number),
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
                units: { type: 'Mm' },
                tag: null,
                __geoMeta: {
                  id: expect.any(String),
                  sourceRange: [expect.any(Number), expect.any(Number), 0],
                },
              },
            ],
          },
          height: 2,
          startCapId: expect.any(String),
          endCapId: expect.any(String),
          units: {
            type: 'Mm',
          },
        },
      },
    ])
  })
})
