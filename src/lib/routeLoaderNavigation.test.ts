import { PATHS } from '@src/lib/paths'
import { getOnboardingChildRoute } from '@src/lib/routeLoaderNavigation'
import { describe, expect, it } from 'vitest'

describe('route loader onboarding file navigation helpers', () => {
  const blankFilePath =
    '/documents/zoo-design-studio-projects/tutorial-project/blank.kcl'
  it('preserves onboarding child routes when a requested onboarding file falls back', () => {
    expect(
      getOnboardingChildRoute(
        `http://localhost:3000${PATHS.FILE}/${encodeURIComponent(
          blankFilePath
        )}/onboarding/desktop/scene?foo=bar`,
        blankFilePath
      )
    ).toBe('/onboarding/desktop/scene')
  })

  it('does not preserve unrelated child routes during fallback', () => {
    expect(
      getOnboardingChildRoute(
        `http://localhost:3000${PATHS.FILE}/${encodeURIComponent(
          blankFilePath
        )}/settings`,
        blankFilePath
      )
    ).toBe('')
  })
})
