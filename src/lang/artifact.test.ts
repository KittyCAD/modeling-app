import { abstractSyntaxTree } from './abstractSyntaxTree'
import { lexer } from './tokeniser'
import { SketchGroup, ExtrudeGroup } from './executor'
import { initPromise } from './rust'
import { enginelessExecutor, executor } from '../lib/testHelpers'

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
    const programMemory = await enginelessExecutor(
      abstractSyntaxTree(lexer(code))
    )
    const shown = programMemory?.return?.map(
      (a) => programMemory?.root?.[a.name]
    )
    expect(shown).toEqual([
      {
        type: 'sketchGroup',
        start: {
          type: 'base',
          to: [0, 0],
          from: [0, 0],
          __geoMeta: {
            id: '66366561-6465-4734-a463-366330356563',
            sourceRange: [21, 42],
            pathToNode: [],
          },
        },
        value: [
          {
            type: 'toPoint',
            to: [-1.59, -1.54],
            from: [0, 0],
            __geoMeta: {
              sourceRange: [48, 73],
              id: '30366338-6462-4330-a364-303935626163',
              pathToNode: [],
            },
          },
          {
            type: 'toPoint',
            to: [0.46, -5.82],
            from: [-1.59, -1.54],
            __geoMeta: {
              sourceRange: [79, 103],
              id: '32653334-6331-4231-b162-663334363535',
              pathToNode: [],
            },
          },
        ],
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        id: '39643164-6130-4734-b432-623638393262',
        __meta: [{ sourceRange: [21, 42], pathToNode: [] }],
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
    const programMemory = await enginelessExecutor(
      abstractSyntaxTree(lexer(code))
    )
    const shown = programMemory?.return?.map(
      (a) => programMemory?.root?.[a.name]
    )
    expect(shown).toEqual([
      {
        type: 'extrudeGroup',
        id: '65383433-3839-4333-b836-343263636638',
        value: [],
        height: 2,
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        __meta: [
          { sourceRange: [127, 140], pathToNode: [] },
          { sourceRange: [21, 42], pathToNode: [] },
        ],
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
    const programMemory = await enginelessExecutor(
      abstractSyntaxTree(lexer(code))
    )
    const geos = programMemory?.return?.map(
      ({ name }) => programMemory?.root?.[name]
    )
    expect(geos).toEqual([
      {
        type: 'extrudeGroup',
        id: '63333330-3631-4230-b664-623132643731',
        value: [],
        height: 2,
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        __meta: [
          { sourceRange: [212, 227], pathToNode: [] },
          { sourceRange: [13, 34], pathToNode: [] },
        ],
      },
      {
        type: 'extrudeGroup',
        id: '33316639-3438-4661-a334-663262383737',
        value: [],
        height: 2,
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        __meta: [
          { sourceRange: [453, 466], pathToNode: [] },
          { sourceRange: [302, 323], pathToNode: [] },
        ],
      },
    ])
  })
})
