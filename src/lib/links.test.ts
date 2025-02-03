import { VITE_KC_SITE_APP_URL } from 'env'
import { createCreateFileUrl } from './links'

describe(`link creation tests`, () => {
  test(`createCreateFileUrl happy path`, async () => {
    const code = `extrusionDistance = 12`
    const name = `test`
    const units = `mm`

    // Converted with external online tools
    const expectedEncodedCode = `ZXh0cnVzaW9uRGlzdGFuY2UgPSAxMg%3D%3D`
    const expectedLink = `${VITE_KC_SITE_APP_URL}/?create-file=true&name=test&units=mm&code=${expectedEncodedCode}&ask-open-desktop=true`

    const result = createCreateFileUrl({ code, name, units })
    expect(result.toString()).toBe(expectedLink)
  })
})
