import { describe, expect, it } from 'vitest'
import { getButtonClassName } from './buttonClassName'

describe('getButtonClassName', () => {
  it('builds the default class list', () => {
    expect(getButtonClassName()).toBe(
      'zds-button zds-button--tone-primary zds-button--emphasis-solid'
    )
  })

  it('includes variant and caller supplied classes', () => {
    expect(
      getButtonClassName({
        tone: 'danger',
        emphasis: 'outline',
        fullWidth: true,
        className: 'custom-button',
      })
    ).toBe(
      'zds-button zds-button--tone-danger zds-button--emphasis-outline zds-button--full-width custom-button'
    )
  })
})
