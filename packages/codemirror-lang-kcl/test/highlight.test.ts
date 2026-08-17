import type { Highlighter } from '@lezer/highlight'
import {
  classHighlighter,
  highlightTree,
  tagHighlighter,
  tags,
} from '@lezer/highlight'
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

function highlightClassesForToken(
  doc: string,
  token: string,
  occurrence = 0,
  highlighter: Highlighter = classHighlighter
) {
  const tree = KclLanguage.parser.parse(doc)
  const offset = nthTokenOffset(doc, token, occurrence)
  let classes: string | null = null

  highlightTree(tree, highlighter, (from, to, style) => {
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

  const enumDeclaration = `@settings(experimentalFeatures = allow)
type Color { | Red | Green }
`

  // `classHighlighter` emits classes for only three `variableName` modifiers --
  // local, definition and special -- so it cannot see the `constant` modifier a
  // variant carries. This highlighter names the exact tag instead, so the test
  // checks the choice rather than what the default class list happens to expose.
  const variantHighlighter = tagHighlighter([
    { tag: tags.constant(tags.variableName), class: 'enum-variant' },
    { tag: tags.variableName, class: 'plain-variable' },
    { tag: tags.typeName, class: 'type-name' },
  ])

  it('highlights an enum variant as a value, not as a type', () => {
    // A variant is a value: `Color::Red` appears where values appear. Tagging it
    // as a modified `variableName` also keeps it visible, because the editor
    // theme styles `variableName` and has no rule for `typeName` at all.
    for (const variant of ['Red', 'Green']) {
      expect(
        highlightClassesForToken(
          enumDeclaration,
          variant,
          0,
          variantHighlighter
        )
      ).toBe('enum-variant')
    }
  })

  it('distinguishes a variant from an ordinary variable', () => {
    const doc = `${enumDeclaration}shade = Color::Red\n`

    expect(
      highlightClassesForToken(doc, 'shade', 0, variantHighlighter)
    ).not.toBe('enum-variant')
  })

  it('highlights the type keyword like the other declaration keywords', () => {
    expect(highlightClassesForToken(enumDeclaration, 'type')).toBe(
      highlightClassesForToken('myFn = fn() { return 1 }', 'fn')
    )
  })
})
