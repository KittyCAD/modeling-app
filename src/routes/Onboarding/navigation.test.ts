import { describe, expect, it } from 'vitest'

import { shouldNavigateToRequestedPath } from '@src/routes/Onboarding/navigation'

describe('shouldNavigateToRequestedPath', () => {
  it.each(['completed', 'dismissed'] as const)(
    'ignores onboarding work that finishes after onboarding is %s',
    (onboardingStatus) => {
      expect(
        shouldNavigateToRequestedPath({
          currentPathname: '/home',
          onboardingStatus,
          requestedPath:
            '/file/tutorial-project%2Fblank.kcl/onboarding/desktop/scene',
        })
      ).toBe(false)
    }
  )

  it('allows onboarding navigation while the user is still onboarding', () => {
    expect(
      shouldNavigateToRequestedPath({
        currentPathname: '/file/tutorial-project%2Fmain.kcl/onboarding/desktop',
        onboardingStatus: '/desktop/scene',
        requestedPath:
          '/file/tutorial-project%2Fblank.kcl/onboarding/desktop/scene',
      })
    ).toBe(true)
  })

  it('allows ordinary file navigation after onboarding ends', () => {
    expect(
      shouldNavigateToRequestedPath({
        currentPathname: '/home',
        onboardingStatus: 'dismissed',
        requestedPath: '/file/my-project%2Fmain.kcl',
      })
    ).toBe(true)
  })
})
