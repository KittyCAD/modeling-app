import { classHighlighter, highlightTree } from '@lezer/highlight'
import { describe, expect, it } from 'vitest'

import { KclLanguage } from '../src/index'

const code = `@settings(experimentalFeatures = allow)

// Loft a square, a circle, and another circle.
sideLen = 4
squareSketch = sketch(on = XY) {
  line1 = line(start = [var -0.02mm, var 4.02mm], end = [var 0mm, var 0mm])
  coincident([line1.end, ORIGIN])
  line2 = line(start = [var 4.02mm, var 0.03mm], end = [var 4.06mm, var 3.97mm])
`

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function nthTokenOffset(doc: string, token: string, occurrence = 0) {
  const matches = [
    ...doc.matchAll(new RegExp(`\\b${escapeRegExp(token)}\\b`, 'g')),
  ]
  const match = matches.at(occurrence)

  expect(match?.index).toBeDefined()

  return match!.index!
}

function highlightClassesForToken(doc: string, token: string, occurrence = 0) {
  const tree = KclLanguage.parser.parse(doc)
  const offset = nthTokenOffset(doc, token, occurrence)
  let classes: string | null = null

  highlightTree(tree, classHighlighter, (from, to, style) => {
    if (from <= offset && offset + token.length <= to) {
      classes = style
    }
  })

  return classes
}

describe('highlighting', () => {
  it('highlights sketch line definitions consistently in incomplete code', () => {
    const line1Classes = highlightClassesForToken(code, 'line1')
    const line2Classes = highlightClassesForToken(code, 'line2')

    expect(line1Classes).toBe('tok-variableName tok-definition')
    expect(line2Classes).toBe(line1Classes)
  })
})
