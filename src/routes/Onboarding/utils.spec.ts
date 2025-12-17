import type { OnboardingStatus } from '@rust/kcl-lib/bindings/OnboardingStatus'
import type { OnboardingPath } from '@src/lib/onboardingPaths'
import {
  needsToOnboard,
  useAdjacentOnboardingSteps,
} from '@src/routes/Onboarding/utils'
import type { Location } from 'react-router-dom'

describe('Onboarding utility functions', () => {
  describe('useAdjacentOnboardingSteps', () => {
    it('Desktop beginning', () => {
      const stepResults = useAdjacentOnboardingSteps('/desktop', 'desktop')
      const expected: OnboardingStatus[] = ['dismissed', '/desktop/scene']
      expect(stepResults).toEqual(expected)
    })
    it('Desktop middle', () => {
      const stepResults = useAdjacentOnboardingSteps(
        '/desktop/other-panes',
        'desktop'
      )
      const expected: OnboardingStatus[] = [
        '/desktop/project-pane',
        '/desktop/prompt-to-edit',
      ]
      expect(stepResults).toEqual(expected)
    })
    it('Desktop end', () => {
      const stepResults = useAdjacentOnboardingSteps(
        '/desktop/conclusion',
        'desktop'
      )
      const expected: OnboardingStatus[] = ['/desktop/exports', 'completed']
      expect(stepResults).toEqual(expected)
    })
    it('Browser beginning', () => {
      const stepResults = useAdjacentOnboardingSteps('/browser', 'browser')
      const expected: OnboardingStatus[] = ['dismissed', '/browser/scene']
      expect(stepResults).toEqual(expected)
    })
    it('Browser middle', () => {
      const stepResults = useAdjacentOnboardingSteps(
        '/browser/text-to-cad-prompt',
        'browser'
      )
      const expected: OnboardingStatus[] = [
        '/browser/text-to-cad',
        '/browser/feature-tree-pane',
      ]
      expect(stepResults).toEqual(expected)
    })
    it('Browser end', () => {
      const stepResults = useAdjacentOnboardingSteps(
        '/browser/conclusion',
        'browser'
      )
      const expected: OnboardingStatus[] = [
        '/browser/prompt-to-edit-result',
        'completed',
      ]
      expect(stepResults).toEqual(expected)
    })
    it('Errors gracefully', () => {
      const stepResults = useAdjacentOnboardingSteps(
        '/bad-path' as unknown as OnboardingPath,
        'desktop'
      )
      const expected: OnboardingStatus[] = ['dismissed', 'completed']
      expect(stepResults).toEqual(expected)
    })
  })

  describe('needsToOnboard', () => {
    it('in onboarding already does not need onboarding', () => {
      const location: Location = {
        pathname: '/some-file/onboarding/some-step',
        search: '',
        hash: '',
        state: null,
        key: 'default',
      }
      expect(needsToOnboard(location, '')).toEqual(false)
    })
    it('elsewhere with bad status does need onboarding', () => {
      const location: Location = {
        pathname: '/somewhere-else',
        search: '',
        hash: '',
        state: null,
        key: 'default',
      }
      expect(
        needsToOnboard(
          location,
          '/bad-onboarding-status' as unknown as OnboardingStatus
        )
      ).toEqual(true)
    })
    it('elsewhere with completed does not need onboarding', () => {
      const location: Location = {
        pathname: '/somewhere-else',
        search: '',
        hash: '',
        state: null,
        key: 'default',
      }
      expect(needsToOnboard(location, 'completed')).toEqual(false)
    })
  })
})
