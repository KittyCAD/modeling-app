import { generateUuidFromHashSeed } from './uuid'

describe('generateUuidFromHashSeed', () => {
  it('generates a UUID from a hash seed', () => {
    const inputString = 'Hello, World!'
    const uuid = generateUuidFromHashSeed(inputString)
    expect(uuid).toEqual('64666664-3630-4231-a262-326264356230')
  })
})
