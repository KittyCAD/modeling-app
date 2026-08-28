import { describe, expect, it } from 'vitest'
import { glyphNames, glyphs } from './glyphs'
import { iconNames, iconPaths, strokedIconNames } from './icons'

describe('the icon set', () => {
  /*
   * `IconName` is the union of both families, so a name in both would silently
   * resolve to whichever the renderer checks first — and the other glyph would be
   * unreachable data nobody could explain.
   */
  it('draws each name in exactly one family', () => {
    const stroked = new Set<string>(strokedIconNames)
    const shared = glyphNames.filter((name) => stroked.has(name))

    expect(shared).toEqual([])
  })

  it('offers both families under one union', () => {
    expect(iconNames).toHaveLength(strokedIconNames.length + glyphNames.length)
    expect(iconNames).toContain('cube')
    expect(iconNames).toContain('extrude')
  })

  it('has a name for the tools the toolbar ships', () => {
    // Not exhaustive: these are the ones a missing glyph would be most visible
    // on, and the catalog is where the real check lives.
    for (const name of [
      'extrude',
      'fillet',
      'chamfer3d',
      'shell',
      'hollow',
      'patternLinear3d',
      'patternCircular3d',
      'mirror3d',
      'rotate',
      'scale',
      'move',
      'helix',
      'plane',
      'sketch',
      'gdtFlatness',
      'gdtPosition',
      'dimension',
    ]) {
      expect(glyphNames).toContain(name)
    }
  })

  it('gives every glyph a viewBox and a body', () => {
    const broken = glyphNames.filter((name) => {
      const glyph = glyphs[name]
      return !/^-?\d+ -?\d+ \d+ \d+$/.test(glyph.viewBox) || !glyph.body.trim()
    })

    expect(broken).toEqual([])
  })

  /* Markup, so a truncated port would render nothing rather than throwing. */
  it('has balanced markup in every glyph', () => {
    const unbalanced = glyphNames.filter((name) => {
      const body = glyphs[name].body
      const opens = (body.match(/</g) ?? []).length
      const closes = (body.match(/>/g) ?? []).length
      return opens !== closes || !body.startsWith('<')
    })

    expect(unbalanced).toEqual([])
  })

  it('draws every stroked icon with a path', () => {
    const broken = strokedIconNames.filter(
      (name) => !iconPaths[name].startsWith('M')
    )

    expect(broken).toEqual([])
  })
})
