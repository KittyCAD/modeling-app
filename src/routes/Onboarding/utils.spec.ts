import type { OnboardingPath, OnboardingStatus } from '@src/lib/onboardingPaths'
import {
  acceptOnboarding,
  consumeRememberedOnboardingWorkflowPanes,
  needsToOnboard,
  type OnboardingUtilDeps,
  shouldApplyRememberedOnboardingWorkflow,
  useAdjacentOnboardingSteps,
} from '@src/routes/Onboarding/utils'
import type { Location } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@src/hooks/useAbsoluteFilePath', () => ({
  useAbsoluteFilePath: vi.fn(() => '/projects/tutorial-project/main.kcl'),
}))

vi.mock('@src/lib/boot', () => ({
  useApp: vi.fn(() => ({
    settings: {
      send: vi.fn(),
    },
  })),
}))

function createOnboardingDeps(
  result:
    | Awaited<
        ReturnType<OnboardingUtilDeps['projectSession']['createKclFiles']>
      >
    | Promise<
        Awaited<
          ReturnType<OnboardingUtilDeps['projectSession']['createKclFiles']>
        >
      > = {
    projectDirectoryPath: '/projects',
    projectName: 'tutorial-project',
    projectRoot: '/projects/tutorial-project',
    fileName: 'main.kcl',
    filePath: '/projects/tutorial-project/main.kcl',
    message: 'Successfully created 1 file',
  },
  navigate = vi.fn()
): {
  createKclFiles: ReturnType<typeof vi.fn>
  deps: OnboardingUtilDeps
} {
  const createKclFiles = vi.fn(() => result)
  return {
    createKclFiles,
    deps: {
      onboardingStatus: 'dismissed',
      navigate,
      projectSession: {
        createKclFiles,
      } as unknown as OnboardingUtilDeps['projectSession'],
    },
  }
}

describe('Onboarding utility functions', () => {
  describe('acceptOnboarding', () => {
    it('creates the tutorial through project session', async () => {
      const navigate = vi.fn()
      const { createKclFiles, deps } = createOnboardingDeps(undefined, navigate)

      await acceptOnboarding(deps)

      expect(createKclFiles).toHaveBeenCalledWith({
        files: expect.arrayContaining([
          expect.objectContaining({
            requestedFileName: 'main.kcl',
            requestedCode: expect.stringContaining('plateLength = 10'),
            requestedProjectName: 'tutorial-project',
          }),
        ]),
        override: true,
        requestedProjectName: 'tutorial-project',
        requestedProjectTitle: 'tutorial-project',
      })
      expect(navigate).toHaveBeenCalledWith(
        `/file/${encodeURIComponent('/projects/tutorial-project')}/onboarding/desktop`
      )
    })

    it('propagates project session creation failures', async () => {
      const { deps } = createOnboardingDeps(
        Promise.reject(new Error('No writable project library'))
      )

      await expect(acceptOnboarding(deps)).rejects.toThrow(
        'No writable project library'
      )
    })

    it('shares an in-flight replay instead of creating the same suffix twice', async () => {
      let resolveProject:
        | ((
            project: Awaited<
              ReturnType<OnboardingUtilDeps['projectSession']['createKclFiles']>
            >
          ) => void)
        | undefined
      const projectPromise = new Promise<
        Awaited<
          ReturnType<OnboardingUtilDeps['projectSession']['createKclFiles']>
        >
      >((resolve) => {
        resolveProject = resolve
      })
      const navigate = vi.fn()
      const { createKclFiles, deps } = createOnboardingDeps(
        projectPromise,
        navigate
      )

      const firstStart = acceptOnboarding(deps)
      const secondStart = acceptOnboarding(deps)

      expect(secondStart).toBe(firstStart)
      expect(createKclFiles).toHaveBeenCalledOnce()

      resolveProject?.({
        projectDirectoryPath: '/projects',
        projectName: 'tutorial-project',
        projectRoot: '/projects/tutorial-project',
        fileName: 'main.kcl',
        filePath: '/projects/tutorial-project/main.kcl',
        message: 'Successfully created 1 file',
      })
      await Promise.all([firstStart, secondStart])
      expect(navigate).toHaveBeenCalledOnce()
    })
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
