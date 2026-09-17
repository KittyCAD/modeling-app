import {
  type AppNavigationDependencies,
  createAppNavigationService,
  createOpenProjectIntentContribution,
} from '@src/lib/appNavigation'
import type { ResolvedProjectOpen } from '@src/lib/projectOpen'
import {
  defineAppNavigationIntent,
  defineAppNavigationIntentContribution,
  openProjectIntent,
} from '@src/registry/contracts/appNavigation'
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

  const projectOpen = createOpenProjectIntentContribution(dependencies)
  let navigation: ReturnType<typeof createAppNavigationService>
  navigation = createAppNavigationService([projectOpen.contribution], {
    supersedeProjectOpen: projectOpen.supersedeProjectOpen,
    showHome: () =>
      dependencies.showHome((request) =>
        navigation.dispatch(openProjectIntent, request)
      ),
  })
  return {
    dependencies,
    navigation,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('appNavigation', () => {
  test('dispatches a capability-contributed intent from the startup catalog', async () => {
    const openSettingsIntent = defineAppNavigationIntent<
      { tab: string },
      undefined
    >('settings.open')
    const openSettings = vi.fn(async (_input: { tab: string }) => undefined)
    const settingsContribution = defineAppNavigationIntentContribution(
      openSettingsIntent,
      openSettings
    )
    const projectOpen = createOpenProjectIntentContribution({
      resolveProjectOpen: vi.fn(async () => resolvedProject),
      openResolvedProject: vi.fn<
        AppNavigationDependencies['openResolvedProject']
      >(async () => ({
        kind: 'opened',
        data: {
          code: '',
          project: resolvedProject.project,
          file: { ...resolvedProject.file, children: [] },
        },
      })),
    })
    const navigation = createAppNavigationService(
      [projectOpen.contribution, settingsContribution],
      { supersedeProjectOpen: projectOpen.supersedeProjectOpen }
    )

    await navigation.dispatch(openSettingsIntent, { tab: 'project' })

    expect(openSettings).toHaveBeenCalledWith({ tab: 'project' })
  })

  test('rejects dispatch when more than one contribution claims an intent', async () => {
    const intent = defineAppNavigationIntent<Record<string, never>, undefined>(
      'duplicate.intent'
    )
    const first = defineAppNavigationIntentContribution(
      intent,
      async () => undefined
    )
    const second = defineAppNavigationIntentContribution(
      intent,
      async () => undefined
    )
    const navigation = createAppNavigationService([first, second], {
      supersedeProjectOpen: vi.fn(),
    })

    await expect(navigation.dispatch(intent, {})).rejects.toThrow(
      'Multiple application navigation intents handle duplicate.intent.'
    )
  })

  test('returns a canonical redirect without opening a project', async () => {
    const { dependencies, navigation } = navigationHarness({
      resolveProjectOpen: vi.fn<
        AppNavigationDependencies['resolveProjectOpen']
      >(async () => ({
        kind: 'redirect',
        to: '/file/canonical',
      })),
    })

    await expect(
      navigation.dispatch(openProjectIntent, { target: '/projects/bracket' })
    ).resolves.toEqual({ kind: 'redirect', to: '/file/canonical' })
    expect(dependencies.openResolvedProject).not.toHaveBeenCalled()
    expect(dependencies.projectOpened).not.toHaveBeenCalled()
  })

  test('opens a project before projecting its location', async () => {
    const { dependencies, navigation } = navigationHarness()
    const request = { target: '/projects/bracket' }

    await expect(
      navigation.dispatch(openProjectIntent, { target: '/projects/bracket' })
    ).resolves.toMatchObject({ kind: 'opened' })
    expect(dependencies.openResolvedProject).toHaveBeenCalledWith(
      resolvedProject,
      expect.any(Function)
    )
    expect(dependencies.projectOpened).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'opened' }),
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

    const firstOpen = navigation.dispatch(openProjectIntent, {
      target: '/projects/bracket',
    })
    await expect(
      navigation.dispatch(openProjectIntent, { target: '/projects/gear' })
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

    const firstOpen = navigation.dispatch(openProjectIntent, {
      target: '/projects/bracket',
    })
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

    const open = navigation.dispatch(openProjectIntent, {
      target: '/projects/bracket',
      signal: controller.signal,
    })
    controller.abort()
    finishResolution()

    await expect(open).rejects.toMatchObject({ name: 'AbortError' })
  })
})
