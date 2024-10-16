import { CREATE_FILE_URL_PARAM } from './constants'
import { createFileLink } from './createFileLink'

describe(`createFileLink`, () => {
  test(`with simple code`, async () => {
    const code = `extrusionDistance = 12`
    const name = `test`
    const units = `mm`

    // Converted with external online tools
    const expectedEncodedCode = `ZXh0cnVzaW9uRGlzdGFuY2UgPSAxMg%3D%3D`
    const expectedLink = `http:/localhost:3000/?${CREATE_FILE_URL_PARAM}&name=test&units=mm&code=${expectedEncodedCode}`

    const result = createFileLink({ code, name, units })
    expect(result).toBe(expectedLink)
  })
})
