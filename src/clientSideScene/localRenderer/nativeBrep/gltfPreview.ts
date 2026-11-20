import type { NativeBrepSceneSnapshot, NativeBrepSnapshot } from '@kittycad/lib'

type Brep = NativeBrepSnapshot['brep']
type Surface = Brep['surfaces'][number]
type Nurbs = Extract<Surface, { type: 'nurbs' }>['nurbs']
type Ref = [number, 1 | -1]
type Extension = {
  solids: { shells: Ref[]; extras?: { KITTYCAD?: { uuid?: string } } }[]
  shells: { faces: Ref[] }[]
  faces: { surface: Ref; loops: Ref[] }[]
  surfaces: Surface[]
  loops: Brep['loops']
  curves2D: Brep['curves2D']
}

function closedSurface(nurbs: Nurbs): [boolean, boolean] {
  const [nu, nv] = nurbs.numControlPoints
  const equal = (i: number, j: number) =>
    nurbs.controlPoints[i].every(
      (value, axis) => Math.abs(value - nurbs.controlPoints[j][axis]) < 1e-10
    )
  return [
    Array.from({ length: nv }, (_, v) => equal(v, (nu - 1) * nv + v)).every(
      Boolean
    ),
    Array.from({ length: nu }, (_, u) => equal(u * nv, u * nv + nv - 1)).every(
      Boolean
    ),
  ]
}

export class UnsupportedPreviewGlb extends Error {}

export function readPreviewGlb(buffer: Uint8Array): NativeBrepSceneSnapshot {
  const header = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength
  )
  if (
    header.getUint32(0, true) !== 0x46546c67 ||
    header.getUint32(16, true) !== 0x4e4f534a
  ) {
    throw new Error('Expected a B-rep preview GLB')
  }
  const { extensions, extensionsRequired, meshes } = JSON.parse(
    new TextDecoder().decode(
      buffer.subarray(20, 20 + header.getUint32(12, true))
    )
  ) as {
    extensions?: { KITTYCAD_boundary_representation?: Extension }
    extensionsRequired?: string[]
    meshes?: unknown[]
  }
  const ext = extensions?.KITTYCAD_boundary_representation
  if (
    !ext ||
    !extensionsRequired?.includes('KITTYCAD_boundary_representation') ||
    meshes?.length
  ) {
    throw new UnsupportedPreviewGlb(
      'Engine did not return a mesh-free B-rep preview'
    )
  }
  const toZUp = ([x, y, z]: number[]): [number, number, number] => [x, -z, y]

  return {
    version: 1,
    coordinateSystem: 'z-up',
    errors: [],
    bodies: ext.solids.map((solid, index) => {
      const brep: Brep = { surfaces: [], faces: [], loops: [], curves2D: [] }
      for (const [shellIndex, shellSign] of solid.shells) {
        for (const [faceIndex, faceSign] of ext.shells[shellIndex].faces) {
          const face = ext.faces[faceIndex]
          const [surfaceIndex, sign] = face.surface
          const surface = ext.surfaces[surfaceIndex]
          const surfaceLocal =
            brep.surfaces.push(
              surface.type === 'plane'
                ? {
                    type: 'plane',
                    plane: {
                      origin: toZUp(surface.plane.origin ?? [0, 0, 0]),
                      xAxis: toZUp(surface.plane.xAxis ?? [1, 0, 0]),
                      yAxis: toZUp(surface.plane.yAxis ?? [0, 1, 0]),
                    },
                  }
                : {
                    type: 'nurbs',
                    nurbs: {
                      ...surface.nurbs,
                      closed:
                        surface.nurbs.closed ?? closedSurface(surface.nurbs),
                      controlPoints: surface.nurbs.controlPoints.map(toZUp),
                    },
                  }
            ) - 1
          const loops = face.loops.map(([loopIndex, orientation]): Ref => {
            const traces = ext.loops[loopIndex].traces
            if (!traces?.length) throw new Error('Missing UV trims')
            const local =
              brep.loops.push({
                traces: traces.map(({ curve: [curveIndex, direction], t }) => ({
                  curve: [
                    brep.curves2D.push(ext.curves2D[curveIndex]) - 1,
                    direction,
                  ],
                  t,
                })),
              }) - 1
            return [local, orientation]
          })
          brep.faces.push({
            surface: [surfaceLocal, sign * faceSign * shellSign > 0 ? 1 : -1],
            loops,
          })
        }
      }
      return { id: solid.extras?.KITTYCAD?.uuid ?? String(index), brep }
    }),
  }
}
