import toast from 'react-hot-toast'
import type { OnboardingStatus } from '@rust/kcl-lib/bindings/OnboardingStatus'
import type { OnboardingPath } from '@src/lib/onboardingPaths'
import { ONBOARDING_TOAST_ID } from '@src/lib/constants'
import { DefaultLayoutPaneID } from '@src/lib/layout'
import {
  consumeRememberedOnboardingWorkflowPanes,
  dismissOnboardingInvite,
  needsToOnboard,
  shouldApplyRememberedOnboardingWorkflow,
  useAdjacentOnboardingSteps,
} from '@src/routes/Onboarding/utils'
import type { Location } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/toast', () => ({
  waitForToastAnimationEnd: vi.fn(
    async (_elementId: string, cb: () => void) => {
      cb()
    }
  ),
}))

vi.mock('react-hot-toast', () => ({
  default: {
    dismiss: vi.fn(),
    success: vi.fn(),
  },
}))

describe('Onboarding utility functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    consumeRememberedOnboardingWorkflowPanes()
  })

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

  describe('workflow preference memory', () => {
    it('returns null when no workflow was selected', () => {
      consumeRememberedOnboardingWorkflowPanes()
      expect(consumeRememberedOnboardingWorkflowPanes()).toBeNull()
    })

    it('remembers the selected workflow panes when dismissing the browser invite', () => {
      const settingsActor = {
        send: vi.fn(),
      } as any

      dismissOnboardingInvite(settingsActor, {
        workflowPreference: 'ai',
        showSuccessToast: false,
      })

      expect(settingsActor.send).toHaveBeenCalledWith({
        type: 'set.app.onboardingStatus',
        data: { level: 'user', value: 'dismissed' },
      })
      expect(consumeRememberedOnboardingWorkflowPanes()).toEqual([
        DefaultLayoutPaneID.TTC,
      ])
      expect(toast.dismiss).toHaveBeenCalledWith(ONBOARDING_TOAST_ID)
      expect(toast.success).not.toHaveBeenCalled()
    })
  })

  describe('remembered onboarding workflow application', () => {
    it('applies after dismissing onboarding and leaving onboarding routes', () => {
      expect(
        shouldApplyRememberedOnboardingWorkflow('/file/main.kcl', 'dismissed')
      ).toBe(true)
    })

    it('applies after completing onboarding and leaving onboarding routes', () => {
      expect(
        shouldApplyRememberedOnboardingWorkflow('/file/main.kcl', 'completed')
      ).toBe(true)
    })

    it('does not apply while still inside onboarding routes', () => {
      expect(
        shouldApplyRememberedOnboardingWorkflow(
          '/file/onboarding/desktop/scene',
          'dismissed'
        )
      ).toBe(false)
    })

    it('does not apply before onboarding is dismissed or completed', () => {
      expect(
        shouldApplyRememberedOnboardingWorkflow('/file/main.kcl', '/desktop')
      ).toBe(false)
    })
  })
})
