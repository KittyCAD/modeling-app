import kclSamplesManifestDataUri from '/kcl-samples/manifest.json?url&inline'
import { dataUrlToString } from '@src/lib/utils'

const kclSamplesManifest = JSON.parse(
  dataUrlToString(kclSamplesManifestDataUri)
)

export const kclSamplesManifestWithNoMultipleFiles = kclSamplesManifest.filter(
  (file: { multipleFiles?: any[] }) => !file.multipleFiles
)
export const everyKclSample = kclSamplesManifest

export const findKclSample = (pathFromProjectDirectoryToFirstFile: string) => {
  return everyKclSample.find(
    (sample: {
      pathFromProjectDirectoryToFirstFile: string
    }) =>
      sample.pathFromProjectDirectoryToFirstFile ===
      pathFromProjectDirectoryToFirstFile
  )
}
