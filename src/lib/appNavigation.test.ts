import {
  type AppNavigationDependencies,
  createAppNavigationService,
  createOpenProjectIntentContribution,
  createShowHomeIntentContribution,
} from '@src/lib/appNavigation'
import type { ResolvedProjectOpen } from '@src/lib/projectOpen'
import {
  defineAppNavigationIntent,
  defineAppNavigationIntentContribution,
  openProjectIntent,
  showHomeIntent,
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

  const projectOpen = createOpenProjectIntentContribution(dependencies)
  const showHome = createShowHomeIntentContribution(
    dependencies,
    projectOpen.cancelProjectOpen
  )
  const navigation = createAppNavigationService([
    projectOpen.contribution,
    showHome,
  ])
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
    >('settings.open', { placement: 'additional' })
    const openSettings = vi.fn(async (_input: { tab: string }) => undefined)
    const settingsContribution = defineAppNavigationIntentContribution(
      openSettingsIntent,
      openSettings
    )
    const navigation = createAppNavigationService([settingsContribution])

    await navigation.dispatch(openSettingsIntent, { tab: 'project' })

    expect(openSettings).toHaveBeenCalledWith({ tab: 'project' })
    expect(navigation.activeAdditionalIntent.value).toEqual({
      intent: openSettingsIntent,
      input: { tab: 'project' },
    })
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
    const navigation = createAppNavigationService([first, second])

    await expect(navigation.dispatch(intent, {})).rejects.toThrow(
      'Multiple application navigation intents handle duplicate.intent.'
    )
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
      resolvedProject,
      request
    )
    expect(dependencies.openResolvedProject).toHaveBeenCalledBefore(
      vi.mocked(dependencies.projectOpened)
    )
  })

  test('dispatches Home through its contributed intent', async () => {
    const { dependencies, navigation } = navigationHarness()

    await navigation.dispatch(showHomeIntent, {})

    expect(dependencies.showHome).toHaveBeenCalledWith({})
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

  test('showing Home aborts the in-flight project open', async () => {
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
    await navigation.dispatch(showHomeIntent, {})
    finishResolution()

    await expect(firstOpen).rejects.toMatchObject({ name: 'AbortError' })
  })
})
