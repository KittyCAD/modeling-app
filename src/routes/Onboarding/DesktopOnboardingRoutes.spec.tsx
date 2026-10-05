import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  seedPrompt: vi.fn(() => true),
  projectPath: '/projects/onboarding',
  enabled: true,
}))

vi.mock('@src/lib/boot', () => ({
  useApp: () => ({
    project: { projectIORefSignal: { value: { path: mocks.projectPath } } },
    registry: {
      optional: () =>
        mocks.enabled ? { seedPrompt: mocks.seedPrompt } : undefined,
    },
    commands: { actor: { getSnapshot: () => ({}) } },
  }),
}))

vi.mock('@src/routes/Onboarding/utils', () => ({
  OnboardingButtons: () => null,
  OnboardingCard: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  isModelingCmdGroupReady: () => true,
  useAdvanceOnboardingOnFormSubmit: () => {},
  useOnModelingCmdGroupReadyOnce: () => {},
  useOnboardingHighlight: () => {},
  useOnboardingPanes: () => {},
}))

import { desktopOnboardingRoutes } from '@src/routes/Onboarding/DesktopOnboardingRoutes'

function renderStep(path: string) {
  const route = desktopOnboardingRoutes.find((route) => route.path === path)
  expect(route?.element).toBeDefined()
  return render(route?.element)
}

describe('desktop onboarding prompt handoff', () => {
  beforeEach(() => {
    mocks.enabled = true
    mocks.seedPrompt.mockClear()
  })

  test.each([
    [
      '/desktop/zookeeper-prompt',
      'Design a cold plate with a serpentine copper coolant tube and recessed channels for thermal management',
    ],
    [
      '/desktop/prompt-to-edit-prompt',
      'Increase the cold plate length to 12 inches and make the copper tube blue.',
    ],
  ])(
    'seeds %s in the current project without a URL consumer',
    (path, prompt) => {
      renderStep(path)
      expect(mocks.seedPrompt).toHaveBeenCalledExactlyOnceWith(
        mocks.projectPath,
        prompt
      )
    }
  )

  test('does not retain a URL prompt when Zookeeper is disabled', () => {
    mocks.enabled = false
    renderStep('/desktop/zookeeper-prompt')
    expect(mocks.seedPrompt).not.toHaveBeenCalled()
  })
})
