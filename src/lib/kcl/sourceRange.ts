import type { SourceRange } from '@rust/kcl-lib/bindings/SourceRange'

/** Convert one UTF-8 byte offset from kcl-lib into CodeMirror's UTF-16 offset. */
export function byteOffsetToUtf16(source: string, byteOffset: number): number {
  if (byteOffset <= 0) {
    return 0
  }

  let bytes = 0
  let utf16 = 0
  const encoder = new TextEncoder()

  for (const character of source) {
    const nextBytes = encoder.encode(character).byteLength
    if (bytes + nextBytes > byteOffset) {
      break
    }
    bytes += nextBytes
    utf16 += character.length
  }

  return utf16
}

/** Convert the bounds of a Rust source range for use in an editor transaction. */
export function sourceRangeToUtf16(
  source: string,
  range: SourceRange
): readonly [number, number] {
  return [
    byteOffsetToUtf16(source, range[0]),
    byteOffsetToUtf16(source, range[1]),
  ]
}
