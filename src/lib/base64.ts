/**
 * Converts a string to a base64 string, preserving the UTF-8 encoding
 */
export function stringToBase64(str: string) {
  return bytesToBase64(new TextEncoder().encode(str))
}

/**
 * Converts a base64 string to a string, preserving the UTF-8 encoding
 */
export function base64ToString(base64: string) {
  return new TextDecoder().decode(base64ToBytes(base64))
}

/**
 * From the MDN Web Docs
 * https://developer.mozilla.org/en-US/docs/Glossary/Base64#the_unicode_problem
 */
function base64ToBytes(base64: string) {
  const binString = atob(base64)
  return Uint8Array.from(binString, (m) => m.codePointAt(0)!)
}

function bytesToBase64(bytes: Uint8Array) {
  const binString = Array.from(bytes, (byte) =>
    String.fromCodePoint(byte)
  ).join('')
  return btoa(binString)
}
