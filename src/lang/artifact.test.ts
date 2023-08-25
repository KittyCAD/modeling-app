import { parser_wasm } from './abstractSyntaxTree'
import { initPromise } from './rust'
import { enginelessExecutor } from '../lib/testHelpers'

beforeAll(() => initPromise)

describe('testing artifacts', () => {
  // Enable rotations #152
  test('sketch artifacts', async () => {
    const code = `
const mySketch001 = startSketchAt([0, 0])
  |> lineTo([-1.59, -1.54], %)
  |> lineTo([0.46, -5.82], %)
  // |> rx(45, %)
show(mySketch001)`
    const programMemory = await enginelessExecutor(parser_wasm(code))
    // @ts-ignore
    const shown = programMemory?.return?.map(
      // @ts-ignore
      (a) => programMemory?.root?.[a.name]
    )
    expect(shown).toEqual([
      {
        type: 'sketchGroup',
        start: {
          to: [0, 0],
          from: [0, 0],
          name: '',
          __geoMeta: {
            id: expect.any(String),
            sourceRange: [21, 42],
          },
        },
        value: [
          {
            type: 'toPoint',
            name: '',
            to: [-1.59, -1.54],
            from: [0, 0],
            __geoMeta: {
              sourceRange: [48, 73],
              id: expect.any(String),
            },
          },
          {
            type: 'toPoint',
            to: [0.46, -5.82],
            from: [-1.59, -1.54],
            name: '',
            __geoMeta: {
              sourceRange: [79, 103],
              id: expect.any(String),
            },
          },
        ],
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        id: expect.any(String),
        __meta: [{ sourceRange: [21, 42] }],
      },
    ])
  })
  test('extrude artifacts', async () => {
    // Enable rotations #152
    const code = `
const mySketch001 = startSketchAt([0, 0])
  |> lineTo([-1.59, -1.54], %)
  |> lineTo([0.46, -5.82], %)
  // |> rx(45, %)
  |> extrude(2, %)
show(mySketch001)`
    const programMemory = await enginelessExecutor(parser_wasm(code))
    // @ts-ignore
    const shown = programMemory?.return?.map(
      // @ts-ignore
      (a) => programMemory?.root?.[a.name]
    )
    expect(shown).toEqual([
      {
        type: 'extrudeGroup',
        id: expect.any(String),
        value: [],
        height: 2,
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        __meta: [{ sourceRange: [21, 42] }],
      },
    ])
  })
  test('sketch extrude and sketch on one of the faces', async () => {
    // Enable rotations #152
    // TODO #153 in order for getExtrudeWallTransform to work we need to query the engine for the location of a face.
    const code = `
const sk1 = startSketchAt([0, 0])
  |> lineTo([-2.5, 0], %)
  |> lineTo({ to: [0, 10], tag: "p" }, %)
  |> lineTo([2.5, 0], %)
  // |> rx(45, %)
  // |> translate([1,0,1], %)
  // |> ry(5, %)
const theExtrude = extrude(2, sk1)
// const theTransf = getExtrudeWallTransform('p', theExtrude)
const sk2 = startSketchAt([0, 0])
  |> lineTo([-2.5, 0], %)
  |> lineTo({ to: [0, 3], tag: "p" }, %)
  |> lineTo([2.5, 0], %)
  // |> transform(theTransf, %)
  |> extrude(2, %)


show(theExtrude, sk2)`
    const programMemory = await enginelessExecutor(parser_wasm(code))
    // @ts-ignore
    const geos = programMemory?.return?.map(
      // @ts-ignore
      ({ name }) => programMemory?.root?.[name]
    )
    expect(geos).toEqual([
      {
        type: 'extrudeGroup',
        id: expect.any(String),
        value: [],
        height: 2,
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        __meta: [{ sourceRange: [13, 34] }],
      },
      {
        type: 'extrudeGroup',
        id: expect.any(String),
        value: [],
        height: 2,
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        __meta: [{ sourceRange: [302, 323] }],
      },
    ])
  })
})
