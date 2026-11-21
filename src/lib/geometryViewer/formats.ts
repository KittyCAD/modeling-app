import fsZds from '@src/lib/fs-zds'

/** Formats accepted by native KCL foreign imports, including filename aliases. */
const extensions = new Set([
  '.sat',
  '.sab',
  '.catpart',
  '.prt',
  '.fbx',
  '.fbxb',
  '.gltf',
  '.glb',
  '.ipt',
  '.obj',
  '.x_t',
  '.x_b',
  '.ply',
  '.sldprt',
  '.step',
  '.stp',
  '.stl',
  '.3dm',
])

export function isGeometryFile(src: string): boolean {
  return (
    extensions.has(fsZds.extname(src).toLowerCase()) ||
    /.+\.prt\.[1-9]\d*$/i.test(fsZds.basename(src))
  )
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
