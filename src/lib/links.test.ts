import { VITE_KC_SITE_APP_URL } from '@src/env'

import { createCreateFileUrl } from '@src/lib/links'

describe(`link creation tests`, () => {
  test(`createCreateFileUrl happy path`, async () => {
    const code = `extrusionDistance = 12`
    const name = `test`

    // Converted with external online tools
    const expectedEncodedCode = `ZXh0cnVzaW9uRGlzdGFuY2UgPSAxMg%3D%3D`
    const expectedLink = `${VITE_KC_SITE_APP_URL}/?create-file=true&name=test&code=${expectedEncodedCode}&ask-open-desktop=true`

    const result = createCreateFileUrl({ code, name })
    expect(result.toString()).toBe(expectedLink)
  })
})
