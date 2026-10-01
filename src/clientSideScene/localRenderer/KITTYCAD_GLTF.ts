import { Mesh } from 'three'
import type { GLTF, GLTFReference } from 'three/examples/jsm/loaders/GLTFLoader'

export type KITTYCAD_GLTF = GLTF & {
  userData: {
    gltfExtensions: {
      KITTYCAD_boundary_representation: KITTYCAD_GLTF_BREP
    }
  }
}

type KITTYCAD_GLTF_BREP = {
  solids: KITTYCAD_GLTF_SOLID[]
  shells: KITTYCAD_GLTF_SHELL[]
  faces: KITTYCAD_GLTF_FACE[]
  loops: KITTYCAD_GLTF_LOOP[]
  edges: KITTYCAD_GLTF_EDGE[]
  vertices: KIITYCAD_GLTF_VERTEX[]
  surfaces: KIITYCAD_GLTF_SURFACE[]
  curves3D: KITTYCAD_GLTF_CURVE3D[]
}

type OrientedIndex = [index: number, orientation: number]

type KITTYCAD_GLTF_SOLID = {
  shells: OrientedIndex[]
  mesh: number
  extras: {
    KITTYCAD: {
      material: number
    }
  }
}

type KITTYCAD_GLTF_SHELL = {
  faces: OrientedIndex[]
}

type KITTYCAD_GLTF_FACE = {
  surface: OrientedIndex
  loops: OrientedIndex[]
} & KITTYCAD_UUID_EXTRAS

type KITTYCAD_GLTF_LOOP = {
  edges: number[][]
}

export type KITTYCAD_GLTF_EDGE = {
  curve: OrientedIndex
  t: [min: number, max: number]
  name?: string
} & (
  | {
      closed?: false // Omitted means open
      start: number
      end: number
    }
  | {
      closed: true // closed curves are allowed not to have vertices
      start?: number | null
      end?: number | null
    }
) &
  KITTYCAD_UUID_EXTRAS

export type KIITYCAD_GLTF_VERTEX = [number, number, number]

export type KITTYCAD_UUID_EXTRAS = {
  extras: {
    KITTYCAD: {
      uuid: string
    }
  }
}

/** Attach B-rep face IDs to the corresponding glTF primitive meshes. */
export function assignFaceUuids(gltf: KITTYCAD_GLTF) {
  const brep = gltf.userData.gltfExtensions.KITTYCAD_boundary_representation
  const faceIdsBySolidMesh = new Map<number, number[]>()

  for (const solid of brep.solids) {
    const faceIds = solid.shells.flatMap(
      ([shellIndex]) =>
        brep.shells[shellIndex]?.faces.map(([faceIndex]) => faceIndex) ?? []
    )
    faceIdsBySolidMesh.set(solid.mesh, faceIds)
  }

  gltf.scene.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const association = gltf.parser.associations.get(object) as
      | (GLTFReference & { primitives?: number })
      | undefined
    const meshIndex = association?.meshes
    const primitiveIndex = association?.primitives
    if (meshIndex === undefined || primitiveIndex === undefined) return

    const faceIndex = faceIdsBySolidMesh.get(meshIndex)?.[primitiveIndex]
    const face = faceIndex === undefined ? undefined : brep.faces[faceIndex]
    const uuid = face?.extras?.KITTYCAD?.uuid
    if (uuid) object.userData.faceUuid = uuid
  })
}

type KIITYCAD_GLTF_SURFACE = {
  type: 'plane'
  plane: {
    xAxis: KIITYCAD_GLTF_VERTEX
    yAxis: KIITYCAD_GLTF_VERTEX
    origin: KIITYCAD_GLTF_VERTEX
  }
} & KITTYCAD_UUID_EXTRAS

export type KITTYCAD_GLTF_CURVE3D =
  | {
      type: 'line'
      line: {
        origin: KIITYCAD_GLTF_VERTEX
        direction: KIITYCAD_GLTF_VERTEX
      }
    }
  | {
      type: 'circle'
      circle: {
        origin?: KIITYCAD_GLTF_VERTEX
        xAxis?: KIITYCAD_GLTF_VERTEX
        yAxis?: KIITYCAD_GLTF_VERTEX
        radius: number
      }
    }
  | {
      type: 'nurbs'
      nurbs: {
        controlPoints: KIITYCAD_GLTF_VERTEX[]
        order: number
        knotVector: number[]
        weights?: number[]
      }
    }
