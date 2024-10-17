import { UnitLength_type } from '@kittycad/lib/dist/types/src/models'
import { CREATE_FILE_URL_PARAM } from './constants'
import { stringToBase64 } from './base64'

export interface FileLinkParams {
  code: string
  name: string
  units: UnitLength_type
}

/**
 * Given a file's code, name, and units, creates shareable link
 */
export async function createFileLink({ code, name, units }: FileLinkParams) {
  const token = await getAndSyncStoredToken(input)
  const urlUserShortlinks = withBaseURL('/user/shortlinks')

  const origin = globalThis.window.location.origin

  if (!token && isDesktop()) return Promise.reject(new Error('No token found'))

  let headers = {
    'Content-Type': 'application/json',
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const urlFileToShare = new URL(
    `/?${CREATE_FILE_URL_PARAM}&name=${encodeURIComponent(
      name
    )}&units=${units}&code=${encodeURIComponent(stringToBase64(code))}`,
    origin
  ).toString()

  const resp = await fetch(urlUserShortlinks, {
    headers,
    body: JSON.stringify({ url: urlFileToShare }),
  })
  const shortlink = await resp.json()

  return shortlink.url
}
