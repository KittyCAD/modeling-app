import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader'

export type KITTYCAD_GLTF = GLTF & {
  userData: {
    // Absent when the engine exports a model without B-rep data.
    gltfExtensions?: {
      KITTYCAD_boundary_representation?: KITTYCAD_GLTF_BREP
    }
    // Sketches and their regions. Only engines that export them send these.
    KITTYCAD?: {
      sketches?: KITTYCAD_GLTF_SKETCH_SEGMENT[]
      regions?: KITTYCAD_GLTF_SKETCH_REGION[]
    }
  }
}

// One sketch segment. Its curve is the B-rep edge at `edge`.
export type KITTYCAD_GLTF_SKETCH_SEGMENT = {
  edge: number
  segmentId?: string
}

// A closed region of a sketch, bounded by B-rep loops. The plane is in glTF
// coordinates: meters, Y up.
export type KITTYCAD_GLTF_SKETCH_REGION = {
  planeOrigin: KIITYCAD_GLTF_VERTEX
  planeXAxis: KIITYCAD_GLTF_VERTEX
  planeYAxis: KIITYCAD_GLTF_VERTEX
  outerLoop: number
  holeLoops?: number[]
  regionId?: string
}

export type KITTYCAD_GLTF_BREP = {
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
