import { UnitLength_type } from '@kittycad/lib/dist/types/src/models'
import { CREATE_FILE_URL_PARAM, PROD_APP_URL } from './constants'
import { stringToBase64 } from './base64'

export interface FileLinkParams {
    code: string
    name: string
    units: UnitLength_type
}

/**
 * Given a file's code, name, and units, creates shareable link
 * TODO: make the app respect this link
 */
export function createFileLink({
  code,
  name,
  units,
}: FileLinkParams) {
  return new URL(
    `/?${CREATE_FILE_URL_PARAM}&name=${encodeURIComponent(
      name
    )}&units=${units}&code=${encodeURIComponent(stringToBase64(code))}`,
    PROD_APP_URL
  ).href
}
