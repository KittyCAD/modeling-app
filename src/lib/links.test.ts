import { createCreateFileUrl } from './links'

describe(`link creation tests`, () => {
  test(`createCreateFileUrl happy path`, async () => {
    const code = `extrusionDistance = 12`
    const name = `test`
    const units = `mm`

    // Converted with external online tools
    const expectedEncodedCode = `ZXh0cnVzaW9uRGlzdGFuY2UgPSAxMg%3D%3D`
    const expectedLink = `http://localhost:3000/?create-file=&name=test&units=mm&code=${expectedEncodedCode}&askToOpenInDesktop`

    const result = createCreateFileUrl({ code, name, units })
    expect(result.toString()).toBe(expectedLink)
  })
})
