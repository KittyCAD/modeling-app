import { CREATE_FILE_URL_PARAM, PROD_APP_URL } from './constants'
import { createFileLink } from './createFileLink'

describe(`createFileLink`, () => {
  test(`with simple code`, async () => {
    const code = `extrusionDistance = 12`
    const name = `test`
    const units = `mm`

    // Converted with external online tools
    const expectedEncodedCode = `ZXh0cnVzaW9uRGlzdGFuY2UgPSAxMg%3D%3D`
    const expectedLink = `${PROD_APP_URL}/?${CREATE_FILE_URL_PARAM}&name=test&units=mm&code=${expectedEncodedCode}`

    const result = createFileLink({ code, name, units })
    expect(result).toBe(expectedLink)
  })
})
