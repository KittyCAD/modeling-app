import { UnitLength_type } from '@kittycad/lib/dist/types/src/models'
import { postUserShortlink } from 'lib/desktop'
import { CREATE_FILE_URL_PARAM } from './constants'
import { stringToBase64 } from './base64'
import withBaseURL from 'lib/withBaseURL'
import { isDesktop } from 'lib/isDesktop'

export interface FileLinkParams {
  code: string
  name: string
  units: UnitLength_type
}

/**
 * Given a file's code, name, and units, creates shareable link
 */
export async function createFileLink(token: string, { code, name, units }: FileLinkParams) {
  let urlUserShortlinks = withBaseURL('/users/shortlinks')

  // During development, the "handler" needs to first be the web app version,
  // which exists on localhost:3000 typically.
  let origin = 'http://localhost:3000'

  let urlFileToShare = new URL(
    `/?${CREATE_FILE_URL_PARAM}&name=${encodeURIComponent(
      name
    )}&units=${units}&code=${encodeURIComponent(stringToBase64(code))}`,
    origin,
  ).toString()

  // Remove this monkey patching
  function fixTheBrokenShitUntilItsFixedOnDev() {
    urlUserShortlinks = urlUserShortlinks.replace('https://api.dev.zoo.dev', 'https://api.zoo.dev')
    console.log(urlUserShortlinks)
  }

  fixTheBrokenShitUntilItsFixedOnDev()

  return await fetch(urlUserShortlinks, {
    method: 'POST',
    headers: {
      'Content-type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ url: urlFileToShare })
  }).then((resp) => resp.json())
}
