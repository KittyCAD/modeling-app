import { KCL_SAMPLES_MANIFEST_URLS } from './constants'
import { isDesktop } from './isDesktop'

export type KclSamplesManifestItem = {
  file: string
  pathFromProjectDirectoryToFirstFile: string
  multipleFiles: boolean
  title: string
  description: string
}

export async function getKclSamplesManifest() {
  // TODO: enable remote fetching again, maybe?
  // let response = await fetch(KCL_SAMPLES_MANIFEST_URLS.remote)
  // if (!response.ok) {
  //   console.warn(
  //     'Failed to fetch latest remote KCL samples manifest, falling back to local:',
  //     response.statusText
  //   )
  //   response = await fetch(
  //     (isDesktop() ? '.' : '') + KCL_SAMPLES_MANIFEST_URLS.localFallback
  //   )
  //   if (!response.ok) {
  //     console.error(
  //       'Failed to fetch fallback KCL samples manifest:',
  //       response.statusText
  //     )
  //     return []
  //   }
  // }
  const response = await fetch(
    (isDesktop() ? '.' : '') + KCL_SAMPLES_MANIFEST_URLS.localFallback
  )
  return response.json().then((manifest) => {
    return manifest as KclSamplesManifestItem[]
  })
}
