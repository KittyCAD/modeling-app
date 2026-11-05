import type {
  AxisDirectionPair,
  GltfStorage,
  OutputFormat3d,
  PlyStorage,
  StlStorage,
} from '@kittycad/lib'

export const exportOptions = {
  type: {
    gltf: 'glTF',
    obj: 'OBJ',
    stl: 'STL',
    step: 'STEP',
    ply: 'PLY',
    // FBX export is not offered in the UI.
    fbx: null,
  } satisfies Record<OutputFormat3d['type'], string | null>,
  gltfStorage: {
    binary: 'binary',
    embedded: 'embedded',
    standard: 'standard',
  } satisfies Record<GltfStorage, string>,
  stlStorage: {
    ascii: 'ascii',
    binary: 'binary',
  } satisfies Record<StlStorage, string>,
  plyStorage: {
    ascii: 'ascii',
    binary_big_endian: 'binary_big_endian',
    binary_little_endian: 'binary_little_endian',
  } satisfies Record<PlyStorage, string>,
  up: {
    z: 'Z+',
    y: 'Y+',
  } satisfies Record<AxisDirectionPair['axis'], string>,
}
