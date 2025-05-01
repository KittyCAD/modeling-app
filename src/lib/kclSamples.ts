import kclSamplesManifest from '@public/kcl-samples/manifest.json'

const kclSamplesManifestWithNoMultipleFiles = kclSamplesManifest.filter(
  (file) => !file.multipleFiles
)

const everyKclSample = kclSamplesManifest

export const findKclSample = (pathFromProjectDirectoryToFirstFile: string) => {
  return everyKclSample.find(
    (sample) =>
      sample.pathFromProjectDirectoryToFirstFile ===
      pathFromProjectDirectoryToFirstFile
  )
}

export { everyKclSample, kclSamplesManifestWithNoMultipleFiles }
