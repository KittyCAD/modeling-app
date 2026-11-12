// Preserve the UTF-8 byte order mark when editing.
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const UNSUPPORTED_TEXT_MESSAGE = 'This file is binary or is not UTF-8 text.'

export function decodeTextFile(
  bytes: Uint8Array | ArrayBuffer
): string | Error {
  try {
    const text = decoder.decode(bytes)
    // Allow tabs and line endings, but reject other control characters.
    for (const character of text) {
      const isControlCharacter = /\p{Control}/u.test(character)
      const isAllowedWhitespace = '\t\n\r'.includes(character)
      if (isControlCharacter && !isAllowedWhitespace) {
        return new Error(UNSUPPORTED_TEXT_MESSAGE)
      }
    }
    return text
  } catch {
    return new Error(UNSUPPORTED_TEXT_MESSAGE)
  }
}
