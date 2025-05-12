import kclSamplesManifest from '@public/kcl-samples/manifest.json'

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
