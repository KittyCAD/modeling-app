import { KCL_SAMPLES_MANIFEST_URL } from './constants'

export type KclSamplesManifestItem = {
  file: string
  pathFromProjectDirectoryToFirstFile: string
  multipleFiles: boolean
  title: string
  description: string
}

export async function getKclSamplesManifest() {
  const response = await fetch(KCL_SAMPLES_MANIFEST_URL)
  if (!response.ok) {
    console.error(
      'Failed to fetch fallback KCL samples manifest:',
      response.statusText
    )
    return []
  }
  return response.json().then((manifest) => {
    return manifest as KclSamplesManifestItem[]
  })
}
