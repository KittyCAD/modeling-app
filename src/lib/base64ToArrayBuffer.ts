export function base64ToArrayBuffer(base64: string): ArrayBuffer | Error {
  let binaryString
  try {
    binaryString = atob(decodeURIComponent(base64))
  } catch (e) {
    return e as Error
  }
  let bytes = new Uint8Array(binaryString.length)
  for (var i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes.buffer
}
