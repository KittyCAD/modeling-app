import type { ScenePresentation } from '@src/lib/kcl/scene/connection'
import fsZds from '@src/lib/fs-zds'

/** Formats accepted by native KCL foreign imports, including filename aliases. */
const presentations: Readonly<Record<string, ScenePresentation>> = {
  '.sat': 'local',
  '.sab': 'local',
  '.catpart': 'local',
  '.prt': 'local',
  '.ipt': 'local',
  '.x_t': 'local',
  '.x_b': 'local',
  '.sldprt': 'local',
  '.step': 'local',
  '.stp': 'local',
  '.fbx': 'streamed',
  '.fbxb': 'streamed',
  '.gltf': 'streamed',
  '.glb': 'streamed',
  '.obj': 'streamed',
  '.ply': 'streamed',
  '.stl': 'streamed',
  '.3dm': 'streamed',
}
const versionedCreo = /.+\.prt\.[1-9]\d*$/i

export function isGeometryFile(src: string): boolean {
  return (
    Object.hasOwn(presentations, fsZds.extname(src).toLowerCase()) ||
    versionedCreo.test(fsZds.basename(src))
  )
}

/** Mesh imports have no BRep for the geometry-only GLB exporter; show them in the engine's graphics scene. */
export function geometryPresentation(src: string): ScenePresentation {
  if (versionedCreo.test(fsZds.basename(src))) return 'local'
  return presentations[fsZds.extname(src).toLowerCase()] ?? 'streamed'
}

/** Explicit aliases avoid invalid KCL names derived from CAD filenames. */
export function geometryImport(path: string, alias: string): string | Error {
  const normalized = path.replaceAll(fsZds.sep, '/')
  if (
    /[\r\n]/.test(normalized) ||
    (normalized.includes('"') && normalized.includes("'"))
  )
    return new Error(
      'Rename the model or its folders to use a KCL import path without line breaks or both quote styles'
    )
  // KCL import paths retain escape characters; use the other delimiter instead of escaping quotes.
  const quote = normalized.includes('"') ? "'" : '"'
  return `import ${quote}${normalized}${quote} as ${alias}`
}
