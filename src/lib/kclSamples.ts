import kclSamplesManifest from '@public/kcl-samples/manifest.json'
import legacyKclSamplesManifest from '@public/kcl-samples-legacy/manifest.json'
import { webSafePathSplit } from '@src/lib/paths'

export const kclSamplesManifestWithNoMultipleFiles = kclSamplesManifest.filter(
  (file) => !file.multipleFiles
)
export const everyKclSample = kclSamplesManifest

export const findKclSample = (pathFromProjectDirectoryToFirstFile: string) => {
  return everyKclSample.find(
    (sample) =>
      sample.pathFromProjectDirectoryToFirstFile ===
      pathFromProjectDirectoryToFirstFile
  )
}

export async function downloadKclSample(
  pathFromProjectDirectoryToFirstFile: string
) {
  const currentSample = findKclSample(pathFromProjectDirectoryToFirstFile)
  const sample =
    currentSample ??
    legacyKclSamplesManifest.find(
      (sample) =>
        sample.pathFromProjectDirectoryToFirstFile ===
        pathFromProjectDirectoryToFirstFile
    )
  if (!sample) {
    return Promise.reject(new Error("Couldn't find KCL sample."))
  }
  const assetDirectory = currentSample ? 'kcl-samples' : 'kcl-samples-legacy'

  const requestedProjectName = webSafePathSplit(
    sample.pathFromProjectDirectoryToFirstFile
  )[0]
  if (!requestedProjectName) {
    return Promise.reject(new Error('The KCL sample has an invalid path.'))
  }

  const files = await Promise.all(
    sample.files.map(async (file) => {
      const response = await fetch(
        `/${assetDirectory}/${encodeURIComponent(
          requestedProjectName
        )}/${encodeURIComponent(file)}`
      )
      if (!response.ok) {
        return Promise.reject(new Error('Failed to fetch KCL sample file.'))
      }

      return {
        requestedFileName: file,
        requestedData: new Uint8Array(await response.arrayBuffer()),
      }
    })
  )

  return {
    sample,
    requestedProjectName,
    initialProject: {
      files,
      entrypointFilePath: sample.file,
    },
  }
}
