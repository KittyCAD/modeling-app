import { abstractSyntaxTree } from './abstractSyntaxTree'
import { lexer } from './tokeniser'
import { executor, SketchGroup, ExtrudeGroup } from './executor'

describe('testing artifacts', () => {
  test('sketch artifacts', () => {
    const code = `
const mySketch001 = startSketchAt([0, 0])
  |> lineTo([-1.59, -1.54], %)
  |> lineTo([0.46, -5.82], %)
  |> rx(45, %)
show(mySketch001)`
    const programMemory = executor(abstractSyntaxTree(lexer(code)))
    const geos = programMemory?.return?.map(
      (a) => programMemory?.root?.[a.name]
    )
    const artifactsWithoutGeos = removeGeo(geos as any)
    expect(artifactsWithoutGeos).toEqual([
      {
        type: 'sketchGroup',
        start: [0, 0],
        value: [
          {
            type: 'toPoint',
            to: [-1.59, -1.54],
            from: [0, 0],
            __geoMeta: {
              sourceRange: [48, 73],
              pathToNode: [],
              geos: ['line', 'lineEnd'],
            },
          },
          {
            type: 'toPoint',
            to: [0.46, -5.82],
            from: [-1.59, -1.54],
            __geoMeta: {
              sourceRange: [79, 103],
              pathToNode: [],
              geos: ['line', 'lineEnd'],
            },
          },
        ],
        position: [0, 0, 0],
        rotation: [0.3826834323650898, 0, 0, 0.9238795325112867],
        __meta: [
          { sourceRange: [21, 42], pathToNode: [] },
          { sourceRange: [109, 118], pathToNode: [] },
        ],
      },
    ])
  })
  test('extrude artifacts', () => {
    const code = `
const mySketch001 = startSketchAt([0, 0])
  |> lineTo([-1.59, -1.54], %)
  |> lineTo([0.46, -5.82], %)
  |> rx(45, %)
  |> extrude(2, %)
show(mySketch001)`
    const programMemory = executor(abstractSyntaxTree(lexer(code)))
    const geos = programMemory?.return?.map(
      (a) => programMemory?.root?.[a.name]
    )
    const artifactsWithoutGeos = removeGeo(geos as any)
    expect(artifactsWithoutGeos).toEqual([
      {
        type: 'extrudeGroup',
        value: [
          {
            type: 'extrudePlane',
            position: [-0.795, -0.5444722215136415, -0.5444722215136416],
            rotation: [
              0.35471170441873584, 0.3467252481708758, -0.14361830020955396,
              0.8563498075401887,
            ],
            __geoMeta: {
              geo: 'PlaneGeometry',
              sourceRange: [48, 73],
              pathToNode: [],
            },
          },
          {
            type: 'extrudePlane',
            position: [
              -0.5650000000000001, -2.602152954766495, -2.602152954766495,
            ],
            rotation: [
              0.20394238048109659, 0.7817509623502217, -0.3238118510036805,
              0.4923604609001174,
            ],
            __geoMeta: {
              geo: 'PlaneGeometry',
              sourceRange: [79, 103],
              pathToNode: [],
            },
          },
        ],
        height: 2,
        position: [0, 0, 0],
        rotation: [0.3826834323650898, 0, 0, 0.9238795325112867],
        __meta: [
          { sourceRange: [124, 137], pathToNode: [] },
          { sourceRange: [21, 42], pathToNode: [] },
        ],
      },
    ])
  })
  test('sketch extrude and sketch on one of the faces', () => {
    const code = `
const sk1 = startSketchAt([0, 0])
  |> lineTo([-2.5, 0], %)
  |> lineTo({ to: [0, 10], tag: "p" }, %)
  |> lineTo([2.5, 0], %)
  |> rx(45, %)
  |> translate([1,0,1], %)
  |> ry(5, %)
const theExtrude = extrude(2, sk1)
const theTransf = getExtrudeWallTransform('p', theExtrude)
const sk2 = startSketchAt([0, 0])
  |> lineTo([-2.5, 0], %)
  |> lineTo({ to: [0, 3], tag: "p" }, %)
  |> lineTo([2.5, 0], %)
  |> transform(theTransf, %)
  |> extrude(2, %)
  

show(theExtrude, sk2)`
    const programMemory = executor(abstractSyntaxTree(lexer(code)))
    const geos = programMemory?.return?.map(
      (a) => programMemory?.root?.[a.name]
    )
    const artifactsWithoutGeos = removeGeo(geos as any)
    expect(artifactsWithoutGeos).toEqual([
      {
        type: 'extrudeGroup',
        value: [
          {
            type: 'extrudePlane',
            position: [-0.1618929317752782, 0, 1.01798363377866],
            rotation: [
              0.3823192025331841, -0.04029905920751535, -0.016692416874629204,
              0.9230002039112793,
            ],
            __geoMeta: {
              geo: 'PlaneGeometry',
              sourceRange: [40, 60],
              pathToNode: [],
            },
          },
          {
            type: 'extrudePlane',
            position: [
              0.14624915180581843, 3.5355339059327373, 4.540063765792454,
            ],
            rotation: [
              -0.24844095888221532, 0.7523143130765927, -0.2910733573455524,
              -0.5362616571538269,
            ],
            __geoMeta: {
              geo: 'PlaneGeometry',
              sourceRange: [66, 102],
              pathToNode: [],
            },
            name: 'p',
          },
          {
            type: 'extrudePlane',
            position: [
              2.636735897035183, 3.5355339059327386, 4.322174408923308,
            ],
            rotation: [
              0.22212685137378593, 0.7027132469491032, -0.3116187916437232,
              0.5997895323824204,
            ],
            __geoMeta: {
              geo: 'PlaneGeometry',
              sourceRange: [108, 127],
              pathToNode: [],
            },
          },
        ],
        height: 2,
        position: [1.083350440839404, 0, 0.9090389553440874],
        rotation: [
          0.38231920253318413, 0.04029905920751535, -0.01669241687462921,
          0.9230002039112792,
        ],
        __meta: [
          { sourceRange: [190, 218], pathToNode: [] },
          { sourceRange: [13, 34], pathToNode: [] },
        ],
      },
      {
        type: 'extrudeGroup',
        value: [
          {
            type: 'extrudePlane',
            position: [
              0.5230004643466108, 4.393026831645281, 5.367870706359959,
            ],
            rotation: [
              -0.5548685410139091, 0.7377864971619333, 0.3261466075583827,
              -0.20351996751370383,
            ],
            __geoMeta: {
              geo: 'PlaneGeometry',
              sourceRange: [317, 337],
              pathToNode: [],
            },
          },
          {
            type: 'extrudePlane',
            position: [
              0.43055783927228125, 5.453687003425103, 4.311246666755821,
            ],
            rotation: [
              0.5307054034531232, -0.4972416536396126, 0.3641462373475848,
              -0.5818075544860157,
            ],
            __geoMeta: {
              geo: 'PlaneGeometry',
              sourceRange: [343, 378],
              pathToNode: [],
            },
            name: 'p',
          },
          {
            type: 'extrudePlane',
            position: [
              -0.3229447858093035, 3.7387011520000146, 2.6556327856208117,
            ],
            rotation: [
              0.06000443169260189, 0.12863059446321826, 0.6408199244764428,
              -0.7544557394170275,
            ],
            __geoMeta: {
              geo: 'PlaneGeometry',
              sourceRange: [384, 403],
              pathToNode: [],
            },
          },
        ],
        height: 2,
        position: [0.14624915180581843, 3.5355339059327373, 4.540063765792454],
        rotation: [
          0.24844095888221532, -0.7523143130765927, 0.2910733573455524,
          -0.5362616571538269,
        ],
        __meta: [
          { sourceRange: [438, 451], pathToNode: [] },
          { sourceRange: [290, 311], pathToNode: [] },
        ],
      },
    ])
  })
})

function removeGeo(arts: (SketchGroup | ExtrudeGroup)[]): any {
  return arts.map((art) => {
    if (art.type === 'extrudeGroup') {
      return {
        ...art,
        value: art.value.map((v) => ({
          ...v,
          __geoMeta: {
            ...v.__geoMeta,
            geo: v.__geoMeta.geo.type,
          },
        })),
      }
    }
    return {
      ...art,
      value: art.value.map((v) => ({
        ...v,
        __geoMeta: {
          ...v.__geoMeta,
          geos: v.__geoMeta.geos.map((g) => g.type),
        },
      })),
    }
  })
}
