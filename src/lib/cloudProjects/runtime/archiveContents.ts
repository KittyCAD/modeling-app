import JSZip from 'jszip'

export async function readProjectZip(archive: ArrayBuffer) {
  const zip = await JSZip.loadAsync(archive)
  return Promise.all(
    Object.values(zip.files)
      .filter((entry) => !entry.dir && !entry.name.startsWith('__MACOSX/'))
      .map(async (entry) => ({
        relativePath: entry.name,
        data: Uint8Array.from(await entry.async('uint8array')),
      }))
  )
}

export function firstExistingProjectFile(
  paths: ReadonlySet<string>,
  ...candidates: (string | undefined)[]
) {
  return candidates.find(
    (path) => path !== undefined && path !== '' && paths.has(path)
  )
}
