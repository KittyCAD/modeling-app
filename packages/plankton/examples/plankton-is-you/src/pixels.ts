import type { Sprite } from './game'

const alphabet: Record<string, string> = {
  A: '010101111101101',
  B: '110101110101110',
  C: '011100100100011',
  D: '110101101101110',
  E: '111100110100111',
  F: '111100110100100',
  G: '011100101101011',
  H: '101101111101101',
  I: '111010010010111',
  J: '001001001101010',
  K: '101101110101101',
  L: '100100100100111',
  M: '101111111101101',
  N: '101111111111101',
  O: '010101101101010',
  P: '110101110100100',
  Q: '010101101111011',
  R: '110101110101101',
  S: '011100010001110',
  T: '111010010010010',
  U: '101101101101111',
  V: '101101101101010',
  W: '101101111111101',
  X: '101101010101101',
  Y: '101101010010010',
  Z: '111001010100111',
}

/** Seed word tiles with editable pixels; rendering never substitutes HTML text. */
export function wordSprite(word: string): Sprite {
  const pixels = Array.from({ length: 16 }, () => Array<string>(16).fill('0'))
  const lines = word.match(/.{1,4}/g)?.slice(0, 2) ?? []
  lines.forEach((line, lineIndex) => {
    const left = Math.floor((16 - (line.length * 4 - 1)) / 2)
    const top = lines.length === 1 ? 5 : 2 + lineIndex * 7
    ;[...line].forEach((letter, index) => {
      const glyph = alphabet[letter]
      if (!glyph) return
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 3; x++)
          pixels[top + y][left + index * 4 + x] = glyph[y * 3 + x]
      }
    })
  })
  return pixels.map((row) => row.join(''))
}
