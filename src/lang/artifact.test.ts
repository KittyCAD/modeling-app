import { abstractSyntaxTree } from './abstractSyntaxTree'
import { lexer } from './tokeniser'
import { executor, SketchGroup, ExtrudeGroup } from './executor'

describe('testing artifacts', () => {
  test('sketch artifacts', () => {
    const code = `
sketch mySketch001 {
  lineTo(-1.59, -1.54)
  lineTo(0.46, -5.82)
}
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
        value: [
          {
            type: 'toPoint',
            to: [-1.59, -1.54],
            from: [0, 0],
            __geoMeta: {
              sourceRange: [24, 44],
              pathToNode: [],
              geos: ['line', 'lineEnd'],
            },
          },
          {
            type: 'toPoint',
            to: [0.46, -5.82],
            from: [-1.59, -1.54],
            __geoMeta: {
              sourceRange: [47, 66],
              pathToNode: [],
              geos: ['line', 'lineEnd'],
            },
          },
        ],
        position: [0, 0, 0],
        rotation: [0.3826834323650898, 0, 0, 0.9238795325112867],
        __meta: [
          {
            sourceRange: [20, 68],
            pathToNode: ['body', 0, 'declarations', 0, 'init', 0],
          },
          {
            sourceRange: [74, 83],
            pathToNode: [],
          },
        ],
      },
    ])
  })
  test('extrude artifacts', () => {
    const code = `
sketch mySketch001 {
  lineTo(-1.59, -1.54)
  lineTo(0.46, -5.82)
}
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
            position: [0, 0, 0],
            rotation: [0.3826834323650898, 0, 0, 0.9238795325112867],
            __geoMeta: {
              geo: 'PlaneGeometry',
              sourceRange: [47, 66],
              pathToNode: [],
            },
          },
        ],
        height: 2,
        position: [0, 0, 0],
        rotation: [0.3826834323650898, 0, 0, 0.9238795325112867],
        __meta: [
          {
            sourceRange: [89, 102],
            pathToNode: [],
          },
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
