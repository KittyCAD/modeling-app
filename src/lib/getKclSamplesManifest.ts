import { KCL_SAMPLES_MANIFEST_URL } from '@src/lib/constants'
import { isDesktop } from '@src/lib/isDesktop'

export type KclSamplesManifestItem = {
  file: string
  pathFromProjectDirectoryToFirstFile: string
  multipleFiles: boolean
  title: string
  description: string
}

export async function getKclSamplesManifest() {
  const response = await fetch(
    (isDesktop() ? '.' : '') + KCL_SAMPLES_MANIFEST_URL
  )
  if (!response.ok) {
    console.error(
      'Failed to fetch bundled KCL samples manifest:',
      response.statusText
    )
    return []
  }
  return response.json().then((manifest) => {
    return manifest as KclSamplesManifestItem[]
  })
}
