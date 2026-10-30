import { describe, expect, it } from 'vitest'
import { playwrightLayoutConfig } from './configs/playwright'
import { applyFeatureCodeLayout } from './featureCodeLayout'
import { LayoutType } from './types'

describe('feature and code layout preference', () => {
  it('merges an open tree into code and keeps Bodies available', () => {
    const original = structuredClone(playwrightLayoutConfig)
    if (
      original.type !== LayoutType.Splits ||
      original.children[0].type !== LayoutType.Panes
    ) {
      throw new Error('Unexpected test layout')
    }
    original.children[0].activeIndices = [0]
    const merged = applyFeatureCodeLayout(original, false)
    if (
      merged.type !== LayoutType.Splits ||
      merged.children[0].type !== LayoutType.Panes
    ) {
      throw new Error('Unexpected merged layout')
    }
    expect(merged.children[0].activeIndices).toEqual([1])
    expect(merged.children[0].children[0]).toMatchObject({
      id: 'inline-bodies',
      areaType: 'bodies',
    })
    expect(original.children[0].children[0].id).toBe('feature-tree')
    expect(applyFeatureCodeLayout(merged, false)).toEqual(merged)
  })
  it('restores the tree above code when the preference is enabled', () => {
    const separated = applyFeatureCodeLayout(
      applyFeatureCodeLayout(playwrightLayoutConfig, false),
      true
    )
    if (
      separated.type !== LayoutType.Splits ||
      separated.children[0].type !== LayoutType.Panes
    ) {
      throw new Error('Unexpected layout')
    }
    expect(separated.children[0].activeIndices).toEqual([0, 1])
    expect(separated.children[0].children[0].id).toBe('feature-tree')
  })
})
