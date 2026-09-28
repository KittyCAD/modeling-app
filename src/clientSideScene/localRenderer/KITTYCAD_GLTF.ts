import { GLTF } from "three/examples/jsm/loaders/GLTFLoader"

export type KITTYCAD_GLTF = GLTF & {
  userData: {
    KITTYCAD_boundary_representation: {
      solids: KITTYCAD_GLTF_SOLID[]
      shells: KITTYCAD_GLTF_SHELL[]
      faces: KITTYCAD_GLTF_FACE[]
      loops: KITTYCAD_GLTF_LOOP[]
      edges: KITTYCAD_GLTF_EDGE[]
      vertices: KIITYCAD_GLTF_VERTEX[]
      surfaces: KIITYCAD_GLTF_SURFACE[]
      curves3D: KITTYCAD_GLTF_CURVE3D[]
    }
  }
}

type KITTYCAD_GLTF_SOLID = {
  sheels: number[][]
  mesh: number
  extras: {
    KITTYCAD: {
      material: number
    }
  }
}

type KITTYCAD_GLTF_SHELL = {
  faces: KITTYCAD_GLTF_FACE[]
}

type KITTYCAD_GLTF_FACE = {
  surface: number[][]
  loops: number[][]
}

type KITTYCAD_GLTF_LOOP = {
  edges: number[][]
}

type KITTYCAD_GLTF_EDGE = {
  curve: number[] //[number, number] ?
  start: number
  end: number
  t: [number, number]
}

type KIITYCAD_GLTF_VERTEX = [number, number, number]

type KIITYCAD_GLTF_SURFACE = {
  type: 'plane'
  plane: {
    xAxis: [number, number, number]
    yAxis: [number, number, number]
    origin: [number, number, number]
  }
}

type KITTYCAD_GLTF_CURVE3D = {
  type: 'line'
  line: {
    origin: [number, number, number]
    direction: [number, number, number]
  }
}
