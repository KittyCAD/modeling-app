import { UnitLength_type } from '@kittycad/lib/dist/types/src/models'
import { CREATE_FILE_URL_PARAM } from './constants'
import { stringToBase64 } from './base64'
import { ZOO_STUDIO_PROTOCOL } from './link'
export interface FileLinkParams {
  code: string
  name: string
  units: UnitLength_type
}

/**
 * Given a file's code, name, and units, creates shareable link
 * TODO: update the return type to use TS library after its updated
 */
export async function createFileLink(
  token: string,
  { code, name, units }: FileLinkParams
): Promise<Error | { key: string; url: string }> {
  // During development, the "handler" needs to first be the web app version,
  // which exists on localhost:3000 typically.
  let origin = 'http://localhost:3000'

  let urlFileToShare = new URL(
    `?${CREATE_FILE_URL_PARAM}&name=${encodeURIComponent(
      name
    )}&units=${units}&code=${encodeURIComponent(stringToBase64(code))}`,
    origin
  ).toString()

  /**
   * We don't use our `withBaseURL` function here because
   * there is no URL shortener service in the dev API.
  */ 
  const response = await fetch('https://api.zoo.dev/user/shortlinks', {
    method: 'POST',
    headers: {
      'Content-type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      url: urlFileToShare,
      // In future we can support org-scoped and password-protected shortlinks here
      // https://zoo.dev/docs/api/shortlinks/create-a-shortlink-for-a-user?lang=typescript
     }),
  })
  console.log('response', response)
  if (!response.ok) {
    const error = await response.json()
    return new Error(`Failed to create shortlink: ${error.message}`)
  } else {
    return response.json()
  }
}
