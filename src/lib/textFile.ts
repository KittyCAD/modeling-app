export const MAX_EDITABLE_TEXT_FILE_BYTES = 1024 * 1024

// Preserve the UTF-8 byte order mark when editing.
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

/** Decode small UTF-8 text files, rejecting binary control characters. */
export function decodeTextFile(bytes: Uint8Array): string | null {
  if (bytes.byteLength > MAX_EDITABLE_TEXT_FILE_BYTES) return null

  try {
    const text = decoder.decode(bytes)
    for (const character of text) {
      const isControlCharacter = /\p{Control}/u.test(character)
      const isAllowedWhitespace = '\t\n\r'.includes(character)
      if (isControlCharacter && !isAllowedWhitespace) return null
    }
    return text
  } catch {
    return null
  }
}
