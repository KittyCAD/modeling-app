import {
  type AppNavigationDependencies,
  createAppNavigationService,
} from '@src/lib/appNavigation'
import type { ResolvedProjectOpen } from '@src/lib/projectOpen'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const resolvedProject: ResolvedProjectOpen = {
  kind: 'resolved',
  projectName: 'bracket',
  projectPath: '/projects/bracket',
  initialEditorPath: '/projects/bracket/main.kcl',
  project: {
    name: 'bracket',
    path: '/projects/bracket',
    children: [],
    kcl_file_count: 1,
    directory_count: 0,
    metadata: null,
    default_file: '/projects/bracket/main.kcl',
    readWriteAccess: true,
  },
  file: { name: 'main.kcl', path: '/projects/bracket/main.kcl' },
  canonicalTarget: '/projects/bracket/main.kcl',
}

function navigationHarness(overrides: Partial<AppNavigationDependencies> = {}) {
  const dependencies: AppNavigationDependencies = {
    resolveProjectOpen: vi.fn(async () => resolvedProject),
    openResolvedProject: vi.fn<
      AppNavigationDependencies['openResolvedProject']
    >(async (resolution) => ({
      kind: 'opened',
      data: {
        code: 'x = 1',
        project: resolution.project,
        file: { ...resolution.file, children: [] },
      },
    })),
    projectOpened: vi.fn(),
    showHome: vi.fn(async () => undefined),
    ...overrides,
  }

  return {
    dependencies,
    navigation: createAppNavigationService(dependencies),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('appNavigation', () => {
  test('opens a project before projecting its location', async () => {
    const { dependencies, navigation } = navigationHarness()
    const request = { target: '/projects/bracket' }

    await expect(navigation.openProject(request)).resolves.toMatchObject({
      kind: 'opened',
    })
    expect(dependencies.openResolvedProject).toHaveBeenCalledWith(
      resolvedProject,
      expect.any(Function)
    )
    expect(dependencies.projectOpened).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'opened' }),
      resolvedProject,
      request
    )
    expect(dependencies.openResolvedProject).toHaveBeenCalledBefore(
      vi.mocked(dependencies.projectOpened)
    )
  })

  test('delegates showing Home with the same project-open command', async () => {
    const { dependencies, navigation } = navigationHarness()

    await navigation.showHome()

    expect(dependencies.showHome).toHaveBeenCalledWith(navigation.openProject)
  })

  test('a newer project open aborts the in-flight open', async () => {
    let finishResolution: () => void = () => undefined
    const resolutionStarted = new Promise<void>((resolve) => {
      finishResolution = resolve
    })
    const { navigation } = navigationHarness({
      resolveProjectOpen: vi
        .fn<AppNavigationDependencies['resolveProjectOpen']>()
        .mockImplementationOnce(async () => {
          await resolutionStarted
          return resolvedProject
        })
        .mockResolvedValueOnce(resolvedProject),
    })

    const firstOpen = navigation.openProject({ target: '/projects/bracket' })
    await expect(
      navigation.openProject({ target: '/projects/gear' })
    ).resolves.toMatchObject({ kind: 'opened' })
    finishResolution()

    await expect(firstOpen).rejects.toMatchObject({ name: 'AbortError' })
  })

  test('explicit supersession aborts the in-flight project open', async () => {
    let finishResolution: () => void = () => undefined
    const resolutionStarted = new Promise<void>((resolve) => {
      finishResolution = resolve
    })
    const { navigation } = navigationHarness({
      resolveProjectOpen: vi.fn(async () => {
        await resolutionStarted
        return resolvedProject
      }),
    })

    const firstOpen = navigation.openProject({ target: '/projects/bracket' })
    navigation.supersedeProjectOpen()
    finishResolution()

    await expect(firstOpen).rejects.toMatchObject({ name: 'AbortError' })
  })

  test('a caller abort signal aborts the project open', async () => {
    let finishResolution: () => void = () => undefined
    const resolutionStarted = new Promise<void>((resolve) => {
      finishResolution = resolve
    })
    const { navigation } = navigationHarness({
      resolveProjectOpen: vi.fn(async () => {
        await resolutionStarted
        return resolvedProject
      }),
    })
    const controller = new AbortController()

    const open = navigation.openProject({
      target: '/projects/bracket',
      signal: controller.signal,
    })
    controller.abort()
    finishResolution()

    await expect(open).rejects.toMatchObject({ name: 'AbortError' })
  })
})
