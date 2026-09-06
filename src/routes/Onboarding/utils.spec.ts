import type { CreateProjectLibraryTarget } from '@src/lib/commandBarConfigs/projectsCommandConfig'
import {
  DEFAULT_PROJECT_LIBRARY_ID,
  PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
  type ProjectLibrary,
} from '@src/lib/projectLibraries'
import type { Project } from '@src/lib/project'
import type { OnboardingPath, OnboardingStatus } from '@src/lib/onboardingPaths'
import {
  acceptOnboarding,
  consumeRememberedOnboardingWorkflowPanes,
  needsToOnboard,
  type OnboardingUtilDeps,
  shouldApplyRememberedOnboardingWorkflow,
  useAdjacentOnboardingSteps,
  useOnboardingStartPending,
} from '@src/routes/Onboarding/utils'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { Location } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalElectron = window.electron

function setDesktop(isDesktop: boolean) {
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: isDesktop ? {} : undefined,
  })
}

function createProject(defaultFile: string): Project {
  const path = defaultFile.slice(0, defaultFile.lastIndexOf('/'))
  return {
    metadata: null,
    kcl_file_count: 1,
    directory_count: 0,
    default_file: defaultFile,
    path,
    name: path.slice(path.lastIndexOf('/') + 1),
    children: null,
    readWriteAccess: true,
  }
}

function createTarget({
  id,
  path,
  result,
}: {
  id: string
  path: string
  result: Project | Promise<Project>
}) {
  const library: ProjectLibrary = {
    id,
    title: id,
    path,
    type: id === PERSONAL_CLOUD_PROJECT_LIBRARY_ID ? 'cloud' : 'directory',
    order: 0,
  }
  const run = vi.fn(() => result)
  const target: CreateProjectLibraryTarget = {
    library,
    createProject: { run },
  }
  return { run, target }
}

function createOnboardingDeps(
  targets: CreateProjectLibraryTarget[],
  navigate = vi.fn()
): OnboardingUtilDeps {
  return {
    app: { getCreateProjectLibraryTargets: () => targets },
    onboardingStatus: 'dismissed',
    navigate,
  }
}

afterEach(() => {
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: originalElectron,
  })
})

describe('Onboarding utility functions', () => {
  describe('acceptOnboarding', () => {
    it.each([
      {
        name: 'web Personal Cloud',
        desktop: false,
        ids: [DEFAULT_PROJECT_LIBRARY_ID, PERSONAL_CLOUD_PROJECT_LIBRARY_ID],
        selectedId: PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
        defaultFile:
          '/documents/zoo-design-studio-projects/tutorial-project/main.kcl',
      },
      {
        name: 'desktop directory',
        desktop: true,
        ids: [PERSONAL_CLOUD_PROJECT_LIBRARY_ID, DEFAULT_PROJECT_LIBRARY_ID],
        selectedId: DEFAULT_PROJECT_LIBRARY_ID,
        defaultFile: '/projects/tutorial-project-1/main.kcl',
      },
      {
        name: 'cloud-only desktop',
        desktop: true,
        ids: [PERSONAL_CLOUD_PROJECT_LIBRARY_ID],
        selectedId: PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
        defaultFile: '/cloud/tutorial-project/main.kcl',
      },
      {
        name: 'directory-only web fallback',
        desktop: false,
        ids: [DEFAULT_PROJECT_LIBRARY_ID],
        selectedId: DEFAULT_PROJECT_LIBRARY_ID,
        defaultFile: '/projects/tutorial-project/main.kcl',
      },
    ])('creates the tutorial through $name', async (testCase) => {
      setDesktop(testCase.desktop)
      const targets = testCase.ids.map((id) =>
        createTarget({
          id,
          path: id === DEFAULT_PROJECT_LIBRARY_ID ? '/projects' : '/cloud',
          result: createProject(testCase.defaultFile),
        })
      )
      const selected = targets.find(
        ({ target }) => target.library.id === testCase.selectedId
      )
      const navigate = vi.fn()

      await acceptOnboarding(
        createOnboardingDeps(
          targets.map(({ target }) => target),
          navigate
        )
      )

      expect(selected?.run).toHaveBeenCalledWith({
        library: selected?.target.library,
        requestedProjectName: 'tutorial-project',
        requestedProjectTitle: 'tutorial-project',
        initialKclFile: {
          fileName: 'main.kcl',
          code: expect.stringContaining('plateLength = 10'),
        },
      })
      for (const unselected of targets.filter(
        ({ target }) => target.library.id !== testCase.selectedId
      )) {
        expect(unselected.run).not.toHaveBeenCalled()
      }
      expect(navigate).toHaveBeenCalledWith(
        `/file/${encodeURIComponent(testCase.defaultFile)}/onboarding/desktop`
      )
    })

    it('fails without overwriting when no writable library is available', async () => {
      setDesktop(false)

      await expect(acceptOnboarding(createOnboardingDeps([]))).rejects.toThrow(
        'No writable project library'
      )
    })

    it('shares an in-flight replay instead of creating the same suffix twice', async () => {
      setDesktop(false)
      let resolveProject: ((project: Project) => void) | undefined
      const projectPromise = new Promise<Project>((resolve) => {
        resolveProject = resolve
      })
      const cloud = createTarget({
        id: PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
        path: '/cloud',
        result: projectPromise,
      })
      const navigate = vi.fn()
      const deps = createOnboardingDeps([cloud.target], navigate)

      const firstStart = acceptOnboarding(deps)
      const secondStart = acceptOnboarding(deps)

      expect(secondStart).toBe(firstStart)
      expect(cloud.run).toHaveBeenCalledOnce()

      resolveProject?.(createProject('/cloud/tutorial-project/main.kcl'))
      await Promise.all([firstStart, secondStart])
      expect(navigate).toHaveBeenCalledOnce()
    })

    it('exposes pending state and restores interaction after a failed replay', async () => {
      setDesktop(false)
      let rejectProject: ((reason: Error) => void) | undefined
      const projectPromise = new Promise<Project>((_resolve, reject) => {
        rejectProject = reject
      })
      const cloud = createTarget({
        id: PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
        path: '/cloud',
        result: projectPromise,
      })
      const { result } = renderHook(() => useOnboardingStartPending())

      expect(result.current).toBe(false)

      let failedStart: Promise<void> | undefined
      act(() => {
        failedStart = acceptOnboarding(createOnboardingDeps([cloud.target]))
      })
      expect(result.current).toBe(true)

      rejectProject?.(new Error('project creation failed'))
      await expect(failedStart).rejects.toThrow('project creation failed')
      await waitFor(() => expect(result.current).toBe(false))

      const retryCloud = createTarget({
        id: PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
        path: '/cloud',
        result: createProject('/cloud/tutorial-project/main.kcl'),
      })
      await acceptOnboarding(createOnboardingDeps([retryCloud.target]))
      expect(retryCloud.run).toHaveBeenCalledOnce()
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
