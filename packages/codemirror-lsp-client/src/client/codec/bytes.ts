import { decoder, encoder } from '../codec'

export default class Bytes {
  static encode(input: string): Uint8Array {
    return encoder.encode(input)
  }

  static decode(input: Uint8Array): string {
    return decoder.decode(input)
  }

  static append<
    T extends { length: number; set(arr: T, offset: number): void },
  >(constructor: { new (length: number): T }, ...arrays: T[]) {
    let totalLength = 0
    for (const arr of arrays) {
      totalLength += arr.length
    }
    const result = new constructor(totalLength)
    let offset = 0
    for (const arr of arrays) {
      result.set(arr, offset)
      offset += arr.length
    }
    return result
  }
}
