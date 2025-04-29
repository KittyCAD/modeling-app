import kclSamplesManifest from '@public/kcl-samples/manifest.json'

const kclSamplesManifestWithNoMultipleFiles = kclSamplesManifest.filter(
  (file) => !file.multipleFiles
)

export { kclSamplesManifest, kclSamplesManifestWithNoMultipleFiles }
