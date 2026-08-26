import type { Feature } from '@kittycad/lib'
import {
  defineRegistryItem,
  pluginsValueSpec,
  provide,
  provideService,
  Registry,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import ProjectSidebarMenu from '@src/components/ProjectSidebarMenu'
import type { App } from '@src/lib/app'
import { cloudSyncRemoteProjects, cloudSyncStatus } from '@src/lib/cloudSync'
import {
  cloudSyncPlugin,
  cloudSyncProjectLibraryType,
  getCloudSyncStatusBarPresentation,
} from '@src/lib/cloudSync/registry/plugin'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'
import fsZds from '@src/lib/fs-zds'
import { homeProjectEntryFromProject } from '@src/lib/homeProjects'
import { localProjectManifestMatchesBase } from '@src/lib/cloudSync/localManifest'
import type { Project } from '@src/lib/project'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  DIRECTORY_PROJECT_LIBRARY_TYPE,
  getDefaultCloudProjectLibrarySetting,
  PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
  type ProjectLibrarySetting,
  projectLibrariesFromSettings,
} from '@src/lib/projectLibraries'
import { appHeaderItemsValueSpec } from '@src/registry/contracts/appHeader'
import type { CloudSyncRegistryService } from '@src/registry/contracts/cloudSync'
import {
  cloudProjectRelationshipsService,
  cloudSyncService,
} from '@src/registry/contracts/cloudSync'
import type { HomeProjectEntry } from '@src/registry/contracts/homeProjects'
import {
  getProjectLibraryCreateProjectOperation,
  projectLibraryRealizationsValueSpec,
  projectLibrarySettingDefaultPoliciesValueSpec,
  projectLibraryTypesValueSpec,
  type ProjectLibraryRealization,
} from '@src/registry/contracts/projectLibraries'
import {
  type SettingsRegistryService,
  settingsService,
} from '@src/registry/contracts/settings'
import { statusBarGlobalItemsValueSpec } from '@src/registry/contracts/statusBar'
import {
  type UserFeaturesRegistryService,
  userFeaturesService,
} from '@src/registry/contracts/userFeatures'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type * as ReactModule from 'react'
import type { ReactNode } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createActor, createMachine } from 'xstate'

const cloudConflictDialogMocks = vi.hoisted(
  (): {
    conflict: unknown
    conflictDialogProjectPath?: string
    dialogProjectPaths: string[]
    errorDialogMessage?: string
    projectMetadata?: unknown
    listeners: Set<() => void>
    notify: () => void
  } => ({
    conflict: undefined,
    conflictDialogProjectPath: undefined,
    dialogProjectPaths: [],
    errorDialogMessage: undefined,
    projectMetadata: undefined,
    listeners: new Set(),
    notify: () => {
      for (const listener of cloudConflictDialogMocks.listeners) {
        listener()
      }
    },
  })
)

vi.mock('@src/components/CloudConflictDialog', async () => {
  const React = await vi.importActual<typeof ReactModule>('react')

  function useMockDialogSignalRender() {
    const [, forceRender] = React.useState(0)

    React.useEffect(() => {
      const listener = () => forceRender((count) => count + 1)
      cloudConflictDialogMocks.listeners.add(listener)

      return () => {
        cloudConflictDialogMocks.listeners.delete(listener)
      }
    }, [])
  }

  function MockCloudConflictDialogHost() {
    useMockDialogSignalRender()

    if (cloudConflictDialogMocks.conflictDialogProjectPath) {
      cloudConflictDialogMocks.dialogProjectPaths.push(
        cloudConflictDialogMocks.conflictDialogProjectPath
      )
    }

    return (
      <>
        {cloudConflictDialogMocks.conflictDialogProjectPath && (
          <div data-testid="cloud-conflict-dialog">
            {cloudConflictDialogMocks.conflictDialogProjectPath}
          </div>
        )}
      </>
    )
  }

  function MockCloudSyncErrorDialogHost() {
    useMockDialogSignalRender()

    return (
      <>
        {cloudConflictDialogMocks.errorDialogMessage && (
          <div data-testid="cloud-sync-error-dialog">
            {cloudConflictDialogMocks.errorDialogMessage}
          </div>
        )}
      </>
    )
  }

  return {
    CloudConflictDialog: ({ projectPath }: { projectPath: string }) => {
      cloudConflictDialogMocks.dialogProjectPaths.push(projectPath)
      return <div data-testid="cloud-conflict-dialog">{projectPath}</div>
    },
    CloudConflictDialogHost: MockCloudConflictDialogHost,
    CloudSyncErrorDialogHost: MockCloudSyncErrorDialogHost,
    openCloudConflictDialog: ({ projectPath }: { projectPath: string }) => {
      cloudConflictDialogMocks.conflictDialogProjectPath = projectPath
      cloudConflictDialogMocks.notify()
    },
    openCloudSyncErrorDialog: ({ message }: { message: string }) => {
      cloudConflictDialogMocks.errorDialogMessage = message
      cloudConflictDialogMocks.notify()
    },
    useCloudSyncProjectConflict: () => cloudConflictDialogMocks.conflict,
    useCloudSyncProjectConflicts: () => [],
    useCloudSyncProjectMetadata: () => cloudConflictDialogMocks.projectMetadata,
  }
})

vi.mock('@src/lib/desktop', () => ({
  writeProjectTitleToProjectToml: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@src/lib/cloudSync/localManifest', () => ({
  localProjectManifestMatchesBase: vi.fn().mockResolvedValue(true),
}))

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const now = Date.now()
const projectWellFormed = {
  name: '550e8400-e29b-41d4-a716-446655440000',
  title: 'Simple Box',
  path: '/some/path/550e8400-e29b-41d4-a716-446655440000',
  children: [
    {
      name: 'main.kcl',
      path: '/some/path/550e8400-e29b-41d4-a716-446655440000/main.kcl',
      children: [],
    },
  ],
  readWriteAccess: true,
  metadata: {
    created: now,
    modified: now,
    size: 32,
    accessed: null,
    type: null,
    permission: null,
  },
  kcl_file_count: 1,
  directory_count: 0,
  default_file: '/some/path/550e8400-e29b-41d4-a716-446655440000/main.kcl',
} satisfies Project

const CLOUD_SYNC_PLUGIN_ID = 'cloud-sync'
const originalElectron = window.electron

type TestSettings = {
  app: {
    machineApi: {
      current: boolean
    }
    theme: {
      current: string
    }
    libraries: {
      current: ProjectLibrarySetting[]
    }
  }
  plugins: {
    [CLOUD_SYNC_PLUGIN_ID]: {
      current: boolean
    }
  }
}

function renderWithRouter(children: ReactNode) {
  return render(<BrowserRouter>{children}</BrowserRouter>)
}

function CloudSyncDialogHostContribution({ app }: { app: App }) {
  const item = app.registry
    .get(appHeaderItemsValueSpec)
    .find((item) => item.id === 'cloud-sync.dialog-app-header-item')
  expect(item).toBeDefined()
  if (!item) {
    return null
  }

  const Component = item.Component
  return <Component app={app} className="" />
}

function createCloudSyncService(): CloudSyncRegistryService {
  return {
    status: signal(cloudSyncStatus.value),
    configure: vi.fn(),
    installFileSystemObserver: vi.fn(),
    retry: vi.fn(),
    setOpenedProject: vi.fn(),
    startProjectSync: vi.fn().mockResolvedValue(undefined),
    disconnectProjectSync: vi.fn().mockResolvedValue(undefined),
    deleteRemoteProject: vi.fn().mockResolvedValue(undefined),
    deleteLocalProjectRealizations: vi.fn().mockResolvedValue(undefined),
    deleteDuplicateProjectRealizations: vi.fn().mockResolvedValue(undefined),
    ensureProjectLocallySynced: vi.fn().mockResolvedValue(undefined),
    getRemoteProjectThumbnailUrl: vi.fn().mockResolvedValue(undefined),
    getProjectMetadata: vi.fn().mockResolvedValue(undefined),
    getProjectMetadataIndex: vi.fn().mockResolvedValue(new Map()),
    getProjectModifiedTime: vi.fn((_metadata, localModified) => localModified),
    resolveProjectConflict: vi.fn().mockResolvedValue(undefined),
  }
}

function projectLibraryRealization({
  libraryType,
  localProjectPath,
  modified = 1,
}: {
  libraryType: string
  localProjectPath: string
  modified?: number
}): ProjectLibraryRealization {
  const localProjectName = localProjectPath.slice(
    localProjectPath.lastIndexOf('/') + 1
  )

  return {
    id: `local:${localProjectPath}`,
    libraryIds: [`${libraryType}-library`],
    libraryRefs: [
      {
        id: `${libraryType}-library`,
        title: libraryType === CLOUD_PROJECT_LIBRARY_TYPE ? 'Cloud' : 'Folder',
        path: libraryType === CLOUD_PROJECT_LIBRARY_TYPE ? '/cloud' : '/files',
        type: libraryType,
      },
    ],
    localProjectPath,
    localProjectName,
    name: localProjectName,
    cloudProjectId: 'remote-123',
    modified,
    readWriteAccess: true,
  }
}

function createSettingsService({
  cloudSyncEnabled = true,
  libraries = [],
}: {
  cloudSyncEnabled?: boolean
  libraries?: ProjectLibrarySetting[]
}) {
  const settingsSignal = signal<TestSettings>({
    app: {
      machineApi: {
        current: false,
      },
      theme: {
        current: 'dark',
      },
      libraries: {
        current: libraries,
      },
    },
    plugins: {
      [CLOUD_SYNC_PLUGIN_ID]: {
        current: cloudSyncEnabled,
      },
    },
  })
  const send = vi.fn(
    (event: {
      type: 'set.app.libraries'
      data: { value: ProjectLibrarySetting[] }
    }) => {
      if (event.type !== 'set.app.libraries') {
        return
      }

      settingsSignal.value = {
        ...settingsSignal.value,
        app: {
          ...settingsSignal.value.app,
          libraries: {
            current: event.data.value,
          },
        },
      }
    }
  )
  const service = {
    actor: {
      getSnapshot: () => ({
        matches: (state: string) => state === 'idle',
      }),
    },
    current: settingsSignal,
    get: () => settingsSignal.value,
    send,
    useSettings: () => settingsSignal.value,
  } as unknown as SettingsRegistryService

  return {
    service,
    settingsSignal,
    send,
  }
}

function createUserFeaturesService(
  featureIds: Set<Feature> = new Set([OPFS_CLOUD_FEATURE_FLAG])
): UserFeaturesRegistryService {
  const context = signal({
    featureIds,
  })

  return {
    context,
    contextSignal: context,
    ready: signal(true),
    has: (featureFlagId: Feature, defaultValue: boolean) =>
      context.value.featureIds.has(featureFlagId) ? true : defaultValue,
    useContext: () => context.value,
    useHas: (featureFlagId: Feature, defaultValue: boolean) =>
      context.value.featureIds.has(featureFlagId) ? true : defaultValue,
  } as unknown as UserFeaturesRegistryService
}

function createProjectMenuApp(cloudSync: CloudSyncRegistryService) {
  const registry = new Registry()
  const settings = createSettingsService({})
  const settingsExtension = defineRegistryItem({
    id: 'test-settings-service',
    providesServices: [provideService(settingsService, settings.service)],
  })
  const cloudSyncServiceExtension = defineRegistryItem({
    id: 'test-cloud-sync-service',
    providesServices: [provideService(cloudSyncService, cloudSync)],
  })
  registry.configure([
    settingsExtension,
    cloudSyncServiceExtension,
    cloudSyncPlugin,
  ])
  enableCloudSyncPlugin(registry)
  const commandsActor = createActor(
    createMachine({
      context: {
        commands: [],
      },
    })
  ).start()

  return {
    app: {
      machineManager: {
        machines: [],
      },
      commands: {
        actor: commandsActor,
        send: vi.fn(),
      },
      settings: {
        actor: {},
        useSettings: () => settings.settingsSignal.value,
      },
      registry,
    } as unknown as App,
    dispose: () => {
      commandsActor.stop()
      registry[Symbol.dispose]()
    },
  }
}

function enableCloudSyncPlugin(registry: Registry) {
  const plugin = registry
    .get(pluginsValueSpec)
    .find((plugin) => plugin.id === CLOUD_SYNC_PLUGIN_ID)
  const pluginService = plugin?.service
  expect(pluginService).toBeDefined()
  if (!pluginService) {
    return
  }

  registry.get(pluginService).enable()
}

afterEach(() => {
  window.electron = originalElectron
  cloudConflictDialogMocks.conflict = undefined
  cloudConflictDialogMocks.conflictDialogProjectPath = undefined
  cloudConflictDialogMocks.dialogProjectPaths = []
  cloudConflictDialogMocks.errorDialogMessage = undefined
  cloudConflictDialogMocks.projectMetadata = undefined
  cloudSyncStatus.value = {
    enabled: false,
    state: 'disabled',
    pendingCount: 0,
  }
  cloudSyncRemoteProjects.value = []
  vi.restoreAllMocks()
})

describe('cloud sync status presentation', () => {
  test('labels remote upload permission failures as blocked sync', () => {
    expect(
      getCloudSyncStatusBarPresentation({
        enabled: true,
        state: 'failed',
        pendingCount: 1,
        lastFailure: 'Cloud sync cannot upload local changes.',
        lastFailureKind: 'remote-upload-forbidden',
        lastFailureAt: new Date(now).toISOString(),
      })
    ).toMatchObject({
      label: 'Cloud sync blocked',
      tooltip: 'Cloud sync cannot upload local changes.',
      isBlocked: true,
    })
  })
})

describe('cloud sync status bar conflict dialog', () => {
  test('contributes the cloud sync status bar item only on home', () => {
    cloudSyncStatus.value = {
      enabled: true,
      state: 'idle',
      pendingCount: 0,
    }
    const registry = new Registry()
    const settings = createSettingsService({})
    const settingsExtension = defineRegistryItem({
      id: 'test-settings-service',
      providesServices: [provideService(settingsService, settings.service)],
    })
    const userFeaturesExtension = defineRegistryItem({
      id: 'test-user-features-service',
      providesServices: [
        provideService(userFeaturesService, createUserFeaturesService()),
      ],
    })

    registry.configure([
      settingsExtension,
      userFeaturesExtension,
      cloudSyncPlugin,
    ])
    enableCloudSyncPlugin(registry)

    try {
      expect(
        registry
          .get(statusBarGlobalItemsValueSpec)
          .find((item) => item.id === 'cloud-sync')
      ).toMatchObject({
        scopes: ['home'],
      })
    } finally {
      registry[Symbol.dispose]()
    }
  })

  test('keeps inspecting the clicked project when global conflict status changes', async () => {
    cloudConflictDialogMocks.conflict = {
      conflict: {
        conflictProjectPath: '/projects/current (cloud conflict)',
        remoteRevision: 'remote-rev-2',
        createdAt: new Date(now).toISOString(),
      },
    }
    cloudSyncStatus.value = {
      enabled: true,
      state: 'conflict',
      pendingCount: 0,
      activeProjectPath: '/projects/current',
      lastFailure: 'Cloud sync conflict: local and remote both changed.',
      lastFailureAt: new Date(now).toISOString(),
    }
    const registry = new Registry()
    const settings = createSettingsService({})
    const settingsExtension = defineRegistryItem({
      id: 'test-settings-service',
      providesServices: [provideService(settingsService, settings.service)],
    })
    const userFeaturesExtension = defineRegistryItem({
      id: 'test-user-features-service',
      providesServices: [
        provideService(userFeaturesService, createUserFeaturesService()),
      ],
    })

    registry.configure([
      settingsExtension,
      userFeaturesExtension,
      cloudSyncPlugin,
    ])
    enableCloudSyncPlugin(registry)

    try {
      const statusItem = registry
        .get(statusBarGlobalItemsValueSpec)
        .find((item) => item.id === 'cloud-sync')
      expect(statusItem).toBeDefined()
      if (!statusItem || !('component' in statusItem)) {
        return
      }

      const StatusBarItem = statusItem.component
      const app = {
        registry,
        settings: {
          useSettings: () => settings.settingsSignal.value,
        },
      } as unknown as App
      window.history.pushState({}, '', '/file/%2Fprojects%2Fcurrent%2Fmain.kcl')
      renderWithRouter(
        <>
          <StatusBarItem />
          <CloudSyncDialogHostContribution app={app} />
        </>
      )

      fireEvent.click(screen.getByTestId('cloud-sync-status'))
      expect(
        await screen.findByTestId('cloud-conflict-dialog')
      ).toHaveTextContent('/projects/current')

      cloudSyncStatus.value = {
        ...cloudSyncStatus.value,
        activeProjectPath: '/projects/other',
        lastFailureAt: new Date(now + 1).toISOString(),
      }

      await waitFor(() =>
        expect(screen.getByTestId('cloud-conflict-dialog')).toHaveTextContent(
          '/projects/current'
        )
      )
      expect(screen.getByTestId('cloud-conflict-dialog')).not.toHaveTextContent(
        '/projects/other'
      )
      expect(cloudConflictDialogMocks.dialogProjectPaths).not.toContain(
        '/projects/other'
      )
    } finally {
      registry[Symbol.dispose]()
    }
  })
})

describe('cloud sync project menu item', () => {
  test('keeps a durable project failure visible after runtime status resets', () => {
    cloudSyncStatus.value = {
      enabled: true,
      state: 'idle',
      pendingCount: 0,
      scopedProjectCloudProjectId: 'remote-123',
    }
    cloudConflictDialogMocks.projectMetadata = {
      localProjectPath: projectWellFormed.path,
      remoteProjectId: 'remote-123',
      lastFailure: {
        message: 'Cloud sync stopped before local changes were uploaded.',
        at: new Date(now - 60_000).toISOString(),
      },
    }
    const cloudSync = createCloudSyncService()
    const { app, dispose } = createProjectMenuApp(cloudSync)

    try {
      renderWithRouter(
        <ProjectSidebarMenu app={app} enableMenu project={projectWellFormed} />
      )

      expect(
        screen.getByTestId('project-sidebar-cloud-error-badge')
      ).toHaveTextContent('Cloud error')
    } finally {
      dispose()
    }
  })

  test('shows a persistent badge when durable project work is stalled', () => {
    cloudSyncStatus.value = {
      enabled: true,
      state: 'idle',
      pendingCount: 0,
      scopedProjectCloudProjectId: 'remote-123',
    }
    cloudConflictDialogMocks.projectMetadata = {
      localProjectPath: projectWellFormed.path,
      remoteProjectId: 'remote-123',
      hasPendingChanges: true,
      pendingSince: new Date(now - 5 * 60_000).toISOString(),
    }
    const cloudSync = createCloudSyncService()
    const { app, dispose } = createProjectMenuApp(cloudSync)

    try {
      renderWithRouter(
        <ProjectSidebarMenu app={app} enableMenu project={projectWellFormed} />
      )

      expect(
        screen.getByTestId('project-sidebar-cloud-stalled-badge')
      ).toHaveTextContent('Cloud sync stalled')
    } finally {
      dispose()
    }
  })

  test('shows synced state from the project sidebar menu', async () => {
    cloudSyncStatus.value = {
      enabled: true,
      state: 'idle',
      pendingCount: 0,
      scopedProjectCloudProjectId: 'remote-123',
      lastSyncedAt: new Date(now).toISOString(),
    }
    const cloudSync = createCloudSyncService()
    const { app, dispose } = createProjectMenuApp(cloudSync)

    try {
      renderWithRouter(
        <>
          <ProjectSidebarMenu
            app={app}
            enableMenu
            project={projectWellFormed}
          />
          <CloudSyncDialogHostContribution app={app} />
        </>
      )

      fireEvent.click(screen.getByTestId('project-sidebar-toggle'))

      expect(
        await screen.findByTestId('project-sidebar-cloud-sync-status')
      ).toHaveTextContent('Cloud synced')
    } finally {
      dispose()
    }
  })

  test('hides quiet cloud sync state for unlinked local projects', () => {
    cloudSyncStatus.value = {
      enabled: true,
      state: 'idle',
      pendingCount: 0,
    }
    const cloudSync = createCloudSyncService()
    const { app, dispose } = createProjectMenuApp(cloudSync)

    try {
      renderWithRouter(
        <>
          <ProjectSidebarMenu
            app={app}
            enableMenu
            project={projectWellFormed}
          />
          <CloudSyncDialogHostContribution app={app} />
        </>
      )

      fireEvent.click(screen.getByTestId('project-sidebar-toggle'))

      expect(
        screen.queryByTestId('project-sidebar-cloud-sync-status')
      ).not.toBeInTheDocument()
    } finally {
      dispose()
    }
  })

  test('opens conflict resolution from the project sidebar menu', async () => {
    cloudSyncStatus.value = {
      enabled: true,
      state: 'conflict',
      pendingCount: 0,
      activeProjectPath: projectWellFormed.path,
      lastFailure: 'Cloud sync conflict: local and remote both changed.',
      lastFailureAt: new Date(now).toISOString(),
    }
    cloudConflictDialogMocks.conflict = {
      conflict: {
        conflictProjectPath: `${projectWellFormed.path} (cloud conflict)`,
        remoteRevision: 'remote-rev-2',
        createdAt: new Date(now).toISOString(),
      },
    }
    const cloudSync = createCloudSyncService()
    const { app, dispose } = createProjectMenuApp(cloudSync)

    try {
      renderWithRouter(
        <>
          <ProjectSidebarMenu
            app={app}
            enableMenu
            project={projectWellFormed}
          />
          <CloudSyncDialogHostContribution app={app} />
        </>
      )

      fireEvent.click(screen.getByTestId('project-sidebar-toggle'))
      fireEvent.click(
        await screen.findByTestId('project-sidebar-inspect-cloud-conflicts')
      )

      expect(
        await screen.findByTestId('cloud-conflict-dialog')
      ).toHaveTextContent(projectWellFormed.path)
      expect(cloudSync.startProjectSync).not.toHaveBeenCalled()
      expect(cloudSync.disconnectProjectSync).not.toHaveBeenCalled()
    } finally {
      dispose()
    }
  })

  test('opens cloud sync error details from the project sidebar menu', async () => {
    cloudSyncStatus.value = {
      enabled: true,
      state: 'failed',
      pendingCount: 1,
      activeProjectPath: projectWellFormed.path,
      lastFailure: 'Cloud sync cannot upload local changes.',
      lastFailureKind: 'remote-upload-forbidden',
      lastFailureAt: new Date(now).toISOString(),
    }
    const cloudSync = createCloudSyncService()
    const { app, dispose } = createProjectMenuApp(cloudSync)

    try {
      renderWithRouter(
        <>
          <ProjectSidebarMenu
            app={app}
            enableMenu
            project={projectWellFormed}
          />
          <CloudSyncDialogHostContribution app={app} />
        </>
      )

      expect(
        screen.getByTestId('project-sidebar-cloud-error-badge')
      ).toHaveTextContent('Cloud error')

      fireEvent.click(screen.getByTestId('project-sidebar-toggle'))
      fireEvent.click(
        await screen.findByTestId('project-sidebar-inspect-cloud-sync-error')
      )

      expect(
        await screen.findByTestId('cloud-sync-error-dialog')
      ).toHaveTextContent('Cloud sync cannot upload local changes.')
      expect(cloudSync.startProjectSync).not.toHaveBeenCalled()
      expect(cloudSync.disconnectProjectSync).not.toHaveBeenCalled()
    } finally {
      dispose()
    }
  })

  test('keeps cloud sync error visible during scheduled retry pulses', async () => {
    cloudSyncStatus.value = {
      enabled: true,
      state: 'syncing',
      pendingCount: 1,
      activeProjectPath: projectWellFormed.path,
      lastFailure: 'Cloud sync cannot upload local changes.',
      lastFailureKind: 'remote-upload-forbidden',
      lastFailureAt: new Date(now).toISOString(),
    }
    const cloudSync = createCloudSyncService()
    const { app, dispose } = createProjectMenuApp(cloudSync)

    try {
      renderWithRouter(
        <ProjectSidebarMenu app={app} enableMenu project={projectWellFormed} />
      )

      expect(
        screen.getByTestId('project-sidebar-cloud-error-badge')
      ).toHaveTextContent('Cloud error')

      fireEvent.click(screen.getByTestId('project-sidebar-toggle'))

      expect(
        await screen.findByTestId('project-sidebar-inspect-cloud-sync-error')
      ).toHaveTextContent('Cloud sync blocked')
      expect(
        screen.queryByTestId('project-sidebar-cloud-sync-status')
      ).not.toBeInTheDocument()
    } finally {
      dispose()
    }
  })
})

describe('cloud sync project library', () => {
  test('registers the cloud project library type as always-on infrastructure', () => {
    const registry = new Registry()
    // The type handler is registered independently of the toggle-able plugin.
    registry.configure([cloudSyncProjectLibraryType])

    try {
      const cloudLibraryType = registry
        .get(projectLibraryTypesValueSpec)
        .get(CLOUD_PROJECT_LIBRARY_TYPE)
      expect(cloudLibraryType).toMatchObject({
        title: 'Cloud',
        icon: 'cloud',
        defaultSetting: getDefaultCloudProjectLibrarySetting(),
        operations: {
          duplicateProject: expect.any(Object),
          openProject: expect.any(Object),
        },
      })
      const cloudLibrary = {
        ...getDefaultCloudProjectLibrarySetting(),
        id: PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
      }
      const project = {
        ...homeProjectEntryFromProject(projectWellFormed),
        id: `local:${projectWellFormed.path}`,
        libraryIds: [PERSONAL_CLOUD_PROJECT_LIBRARY_ID],
      } satisfies HomeProjectEntry

      expect(
        cloudLibraryType?.operations?.openProject?.run({
          library: cloudLibrary,
          project,
        })
      ).toEqual({ defaultFile: projectWellFormed.default_file })
    } finally {
      registry[Symbol.dispose]()
    }
  })

  test('uses Personal Cloud as the web project library default', () => {
    const registry = new Registry()
    const userFeaturesExtension = defineRegistryItem({
      id: 'test-user-features-service',
      providesServices: [
        provideService(userFeaturesService, createUserFeaturesService()),
      ],
    })
    registry.configure([userFeaturesExtension, cloudSyncProjectLibraryType])

    try {
      const defaultPolicies = registry.get(
        projectLibrarySettingDefaultPoliciesValueSpec
      )
      const personalCloudPolicy = defaultPolicies.find(
        (policy) =>
          policy.id === 'cloud-sync.personal-cloud-library-default-policy'
      )

      expect(
        personalCloudPolicy?.getDefaultLibraries({
          initialDefaultDir: '/projects',
          isDesktop: false,
        })
      ).toEqual([getDefaultCloudProjectLibrarySetting()])
      expect(
        personalCloudPolicy?.getDefaultLibraries({
          initialDefaultDir: '/projects',
          isDesktop: true,
        })
      ).toBeUndefined()
    } finally {
      registry[Symbol.dispose]()
    }
  })

  test('keeps the cloud project library default gated by feature flag and platform', () => {
    const registry = new Registry()
    const userFeaturesExtension = defineRegistryItem({
      id: 'test-user-features-service',
      providesServices: [
        provideService(
          userFeaturesService,
          createUserFeaturesService(new Set())
        ),
      ],
    })
    registry.configure([userFeaturesExtension, cloudSyncProjectLibraryType])

    try {
      const defaultPolicies = registry.get(
        projectLibrarySettingDefaultPoliciesValueSpec
      )
      const personalCloudPolicy = defaultPolicies.find(
        (policy) =>
          policy.id === 'cloud-sync.personal-cloud-library-default-policy'
      )

      expect(
        personalCloudPolicy?.getDefaultLibraries({
          initialDefaultDir: '/projects',
          isDesktop: false,
        })
      ).toBeUndefined()
      expect(
        personalCloudPolicy?.getDefaultLibraries({
          initialDefaultDir: '/projects',
          isDesktop: true,
        })
      ).toBeUndefined()
    } finally {
      registry[Symbol.dispose]()
    }
  })

  test('does not synthesize a personal cloud library row when toggled', () => {
    const registry = new Registry()
    registry.configure([cloudSyncProjectLibraryType, cloudSyncPlugin])

    try {
      const plugin = registry
        .get(pluginsValueSpec)
        .find((plugin) => plugin.id === CLOUD_SYNC_PLUGIN_ID)
      const pluginService = plugin?.service
      expect(pluginService).toBeDefined()
      if (!pluginService) {
        return
      }

      const pluginToggle = registry.get(pluginService)
      expect(pluginToggle.active.value).toBe(false)
      expect(
        registry
          .get(projectLibraryTypesValueSpec)
          .has(CLOUD_PROJECT_LIBRARY_TYPE)
      ).toBe(true)

      pluginToggle.enable()
      expect(
        registry
          .get(projectLibraryTypesValueSpec)
          .has(CLOUD_PROJECT_LIBRARY_TYPE)
      ).toBe(true)

      pluginToggle.disable()
      expect(
        registry
          .get(projectLibraryTypesValueSpec)
          .has(CLOUD_PROJECT_LIBRARY_TYPE)
      ).toBe(true)
    } finally {
      registry[Symbol.dispose]()
    }
  })

  test('offers project creation in the cloud library while sync is disabled', () => {
    const registry = new Registry()
    registry.configure([cloudSyncProjectLibraryType])
    cloudSyncStatus.value = {
      enabled: false,
      state: 'disabled',
      pendingCount: 0,
    }

    try {
      const cloudLibraryType = registry
        .get(projectLibraryTypesValueSpec)
        .get(CLOUD_PROJECT_LIBRARY_TYPE)
      expect(cloudLibraryType).toBeDefined()
      if (!cloudLibraryType) {
        return
      }

      const cloudLibrary = {
        ...getDefaultCloudProjectLibrarySetting(),
        id: PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
      }
      // readRealizations and createProject stay available even though cloud sync is
      // off, so a web user who is not actively syncing can still list/create.
      expect(cloudLibraryType.readRealizations).toBeDefined()
      expect(
        getProjectLibraryCreateProjectOperation(cloudLibraryType, cloudLibrary)
      ).toBeDefined()
      expect(cloudLibraryType.operations?.openProject).toBeDefined()
      expect(
        cloudLibraryType.operations?.openProject?.run({
          library: cloudLibrary,
          project: {
            id: 'local:/cloud/moved-project',
            source: 'remote',
            status: 'cloud-only',
            libraryIds: [PERSONAL_CLOUD_PROJECT_LIBRARY_ID],
            name: 'moved-project',
            defaultFile: '/cloud/moved-project/main.kcl',
            readWriteAccess: true,
          },
        })
      ).toEqual({ defaultFile: '/cloud/moved-project/main.kcl' })
      expect(cloudLibraryType.operations?.moveProjectFrom).toBeDefined()
      expect(cloudLibraryType.operations?.moveProjectTo).toBeDefined()
    } finally {
      registry[Symbol.dispose]()
    }
  })

  test('disconnects cloud sync before moving a cloud project to a directory library', async () => {
    const cloudSync = createCloudSyncService()
    const registry = new Registry()
    const cloudSyncServiceExtension = defineRegistryItem({
      id: 'test-cloud-sync-service',
      providesServices: [provideService(cloudSyncService, cloudSync)],
    })

    registry.configure([cloudSyncServiceExtension, cloudSyncProjectLibraryType])

    try {
      const cloudLibraryType = registry
        .get(projectLibraryTypesValueSpec)
        .get(CLOUD_PROJECT_LIBRARY_TYPE)
      expect(cloudLibraryType).toBeDefined()
      const moveProjectFrom = cloudLibraryType?.operations?.moveProjectFrom
      expect(moveProjectFrom).toBeDefined()
      if (!moveProjectFrom) {
        return
      }

      const source = await moveProjectFrom.run({
        library: {
          ...getDefaultCloudProjectLibrarySetting(),
          id: PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
        },
        targetLibrary: {
          id: 'default-project-directory',
          title: 'Default Projects Directory',
          path: '/projects',
          type: DIRECTORY_PROJECT_LIBRARY_TYPE,
        },
        project: {
          id: 'local:/cloud/bracket',
          source: 'remote',
          status: 'synced',
          libraryIds: [PERSONAL_CLOUD_PROJECT_LIBRARY_ID],
          name: 'bracket',
          localProjectPath: '/cloud/bracket',
          localProjectName: 'bracket',
          defaultFile: '/cloud/bracket/main.kcl',
          readWriteAccess: true,
        },
      })

      expect(cloudSync.disconnectProjectSync).toHaveBeenCalledWith(
        '/cloud/bracket'
      )
      expect(source).toEqual({
        localProjectPath: '/cloud/bracket',
        localProjectName: 'bracket',
        defaultFile: '/cloud/bracket/main.kcl',
      })
    } finally {
      registry[Symbol.dispose]()
    }
  })

  test('deletes both local and remote state for a materialized cloud project', async () => {
    cloudSyncStatus.value = {
      enabled: true,
      state: 'idle',
      pendingCount: 0,
    }
    const cloudSync = createCloudSyncService()
    const registry = new Registry()
    const cloudSyncServiceExtension = defineRegistryItem({
      id: 'test-cloud-sync-service',
      providesServices: [provideService(cloudSyncService, cloudSync)],
    })

    registry.configure([cloudSyncServiceExtension, cloudSyncProjectLibraryType])

    try {
      const cloudLibraryType = registry
        .get(projectLibraryTypesValueSpec)
        .get(CLOUD_PROJECT_LIBRARY_TYPE)
      expect(cloudLibraryType).toBeDefined()
      const deleteProject = cloudLibraryType?.operations?.deleteProject
      expect(deleteProject).toBeDefined()
      if (!deleteProject) {
        return
      }

      await deleteProject.run({
        library: {
          ...getDefaultCloudProjectLibrarySetting(),
          id: PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
        },
        project: {
          id: 'local:/cloud/bracket',
          source: 'local',
          status: 'synced',
          libraryIds: [PERSONAL_CLOUD_PROJECT_LIBRARY_ID],
          name: 'bracket',
          localProjectPath: '/cloud/bracket',
          localProjectName: 'bracket',
          remoteProjectId: 'remote-123',
          defaultFile: '/cloud/bracket/main.kcl',
          readWriteAccess: true,
        },
      })

      expect(cloudSync.deleteLocalProjectRealizations).toHaveBeenCalledWith(
        'remote-123',
        '/cloud/bracket'
      )
      expect(cloudSync.deleteRemoteProject).toHaveBeenCalledWith('remote-123')
      expect(
        vi.mocked(cloudSync.deleteLocalProjectRealizations).mock
          .invocationCallOrder[0]
      ).toBeLessThan(
        vi.mocked(cloudSync.deleteRemoteProject).mock.invocationCallOrder[0]
      )
    } finally {
      registry[Symbol.dispose]()
    }
  })

  test('does not locally delete a cloud-backed project when remote delete is unavailable', async () => {
    cloudSyncStatus.value = {
      enabled: false,
      state: 'disabled',
      pendingCount: 0,
    }
    const cloudSync = createCloudSyncService()
    const removeProjectDirectory = vi
      .spyOn(fsZds, 'rm')
      .mockResolvedValue(undefined)
    const registry = new Registry()
    const cloudSyncServiceExtension = defineRegistryItem({
      id: 'test-cloud-sync-service',
      providesServices: [provideService(cloudSyncService, cloudSync)],
    })

    registry.configure([cloudSyncServiceExtension, cloudSyncProjectLibraryType])

    try {
      const cloudLibraryType = registry
        .get(projectLibraryTypesValueSpec)
        .get(CLOUD_PROJECT_LIBRARY_TYPE)
      const deleteProject = cloudLibraryType?.operations?.deleteProject
      expect(deleteProject).toBeDefined()
      if (!deleteProject) {
        return
      }

      await expect(
        deleteProject.run({
          library: {
            ...getDefaultCloudProjectLibrarySetting(),
            id: PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
          },
          project: {
            id: 'local:/cloud/bracket',
            source: 'local',
            status: 'synced',
            libraryIds: [PERSONAL_CLOUD_PROJECT_LIBRARY_ID],
            name: 'bracket',
            localProjectPath: '/cloud/bracket',
            localProjectName: 'bracket',
            remoteProjectId: 'remote-123',
            defaultFile: '/cloud/bracket/main.kcl',
            readWriteAccess: true,
          },
        })
      ).rejects.toThrow('Cloud sync is not enabled.')

      expect(removeProjectDirectory).not.toHaveBeenCalled()
      expect(cloudSync.deleteLocalProjectRealizations).not.toHaveBeenCalled()
      expect(cloudSync.deleteRemoteProject).not.toHaveBeenCalled()
    } finally {
      registry[Symbol.dispose]()
    }
  })

  test('leaves configured personal cloud library order in settings', () => {
    const registry = new Registry()
    const settings = createSettingsService({
      libraries: [
        {
          title: 'Directory',
          path: '/projects',
          type: 'directory',
        },
        getDefaultCloudProjectLibrarySetting(),
      ],
    })
    const settingsExtension = defineRegistryItem({
      id: 'test-settings-service',
      providesServices: [provideService(settingsService, settings.service)],
    })

    registry.configure([settingsExtension, cloudSyncPlugin])

    try {
      const plugin = registry
        .get(pluginsValueSpec)
        .find((plugin) => plugin.id === CLOUD_SYNC_PLUGIN_ID)
      const pluginService = plugin?.service
      expect(pluginService).toBeDefined()
      if (!pluginService) {
        return
      }

      registry.get(pluginService).enable()

      expect(
        projectLibrariesFromSettings(
          settings.service.get().app.libraries.current
        )
      ).toEqual([
        expect.objectContaining({
          title: 'Directory',
          order: 0,
        }),
        expect.objectContaining({
          id: PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
          order: 1,
        }),
      ])
    } finally {
      registry[Symbol.dispose]()
    }
  })

  test('reveals the resolved local storage path from settings details', async () => {
    const registry = new Registry()
    const showInFolder = vi.fn()
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Electron')
    window.electron = {
      os: {
        isMac: true,
      },
      showInFolder,
    } as unknown as Window['electron']

    registry.configure([cloudSyncProjectLibraryType, cloudSyncPlugin])

    try {
      enableCloudSyncPlugin(registry)
      const cloudLibraryType = registry
        .get(projectLibraryTypesValueSpec)
        .get(CLOUD_PROJECT_LIBRARY_TYPE)
      expect(cloudLibraryType?.settingsDetails).toBeDefined()
      const SettingsDetails = cloudLibraryType?.settingsDetails
      if (!SettingsDetails) {
        return
      }

      render(
        <SettingsDetails
          library={getDefaultCloudProjectLibrarySetting()}
          index={0}
          updateLibrary={vi.fn()}
          commitLibrary={vi.fn()}
        />
      )

      const revealButton = await screen.findByRole('button')
      await waitFor(() => expect(revealButton).not.toBeDisabled())

      fireEvent.click(revealButton)

      expect(showInFolder).toHaveBeenCalled()
    } finally {
      registry[Symbol.dispose]()
    }
  })

  test('does not mutate project library settings from plugin activation', async () => {
    const registry = new Registry()
    const settings = createSettingsService({})
    const settingsExtension = defineRegistryItem({
      id: 'test-settings-service',
      providesServices: [provideService(settingsService, settings.service)],
    })

    registry.configure([settingsExtension, cloudSyncPlugin])

    try {
      const plugin = registry
        .get(pluginsValueSpec)
        .find((plugin) => plugin.id === CLOUD_SYNC_PLUGIN_ID)
      const pluginService = plugin?.service
      expect(pluginService).toBeDefined()
      if (!pluginService) {
        return
      }

      registry.get(pluginService).enable()
      await Promise.resolve()
      await Promise.resolve()

      expect(settings.send).not.toHaveBeenCalled()
      expect(settings.settingsSignal.value.app.libraries.current).toEqual([])
    } finally {
      registry[Symbol.dispose]()
    }
  })
})

describe('cloud sync project relationships', () => {
  test('does not manufacture a relationship while waiting for a remote id', async () => {
    cloudSyncStatus.value = {
      enabled: true,
      state: 'idle',
      pendingCount: 1,
    }
    const movedProjectPath = '/some/path/moved-project'
    const cloudSync = createCloudSyncService()
    vi.mocked(cloudSync.getProjectMetadataIndex).mockResolvedValue(
      new Map([
        [
          movedProjectPath,
          {
            schemaVersion: 1,
            localProjectPath: movedProjectPath,
            projectName: 'Moved project',
            hasPendingChanges: true,
          },
        ],
      ])
    )
    const registry = new Registry()
    const cloudSyncServiceExtension = defineRegistryItem({
      id: 'test-cloud-sync-service',
      providesServices: [provideService(cloudSyncService, cloudSync)],
    })

    registry.configure([cloudSyncServiceExtension, cloudSyncPlugin])
    enableCloudSyncPlugin(registry)

    try {
      await waitFor(() =>
        expect(
          registry.get(cloudProjectRelationshipsService).relationships.value
        ).toEqual([])
      )
    } finally {
      registry[Symbol.dispose]()
    }
  })

  test('contributes remote thumbnails for remote-only cloud relationships', async () => {
    cloudSyncStatus.value = {
      enabled: true,
      state: 'idle',
      pendingCount: 0,
    }
    cloudSyncRemoteProjects.value = [
      {
        id: 'remote-123',
        title: 'Remote title',
        revision: 'remote-rev-2',
        updated_at: '2026-06-02T20:00:00.000Z',
      },
    ]
    const cloudSync = createCloudSyncService()
    vi.mocked(cloudSync.getRemoteProjectThumbnailUrl).mockResolvedValue(
      'https://example.test/remote-123-thumbnail.png'
    )
    const registry = new Registry()
    const cloudSyncServiceExtension = defineRegistryItem({
      id: 'test-cloud-sync-service',
      providesServices: [provideService(cloudSyncService, cloudSync)],
    })

    registry.configure([cloudSyncServiceExtension, cloudSyncPlugin])
    enableCloudSyncPlugin(registry)

    try {
      await waitFor(() =>
        expect(
          registry.get(cloudProjectRelationshipsService).relationships.value
        ).toEqual([
          expect.objectContaining({
            remoteProjectId: 'remote-123',
            remoteThumbnailUrl: 'https://example.test/remote-123-thumbnail.png',
            canonicalRealization: undefined,
            duplicateRealizations: [],
          }),
        ])
      )
    } finally {
      registry[Symbol.dispose]()
    }
  })

  test('compares manifests for cloud-library duplicate cleanup candidates', async () => {
    cloudSyncStatus.value = {
      enabled: true,
      state: 'idle',
      pendingCount: 0,
    }
    vi.mocked(localProjectManifestMatchesBase).mockClear()
    vi.mocked(localProjectManifestMatchesBase).mockResolvedValue(true)
    const cloudSync = createCloudSyncService()
    vi.mocked(cloudSync.getProjectMetadataIndex).mockResolvedValue(
      new Map([
        [
          '/cloud/bracket',
          {
            schemaVersion: 1,
            localProjectPath: '/cloud/bracket',
            projectName: 'bracket',
            remoteProjectId: 'remote-123',
            hasPendingChanges: false,
            baseManifest: { files: {} },
          },
        ],
        [
          '/cloud/bracket-copy',
          {
            schemaVersion: 1,
            localProjectPath: '/cloud/bracket-copy',
            projectName: 'bracket-copy',
            remoteProjectId: 'remote-123',
            hasPendingChanges: false,
            baseManifest: { files: {} },
          },
        ],
      ])
    )
    const registry = new Registry()
    const cloudSyncServiceExtension = defineRegistryItem({
      id: 'test-cloud-sync-service',
      providesServices: [provideService(cloudSyncService, cloudSync)],
    })
    const projectRealizationsExtension = defineRegistryItem({
      id: 'test-project-library-realizations',
      provides: [
        provide(projectLibraryRealizationsValueSpec, [
          projectLibraryRealization({
            libraryType: CLOUD_PROJECT_LIBRARY_TYPE,
            localProjectPath: '/cloud/bracket',
            modified: 20,
          }),
          projectLibraryRealization({
            libraryType: CLOUD_PROJECT_LIBRARY_TYPE,
            localProjectPath: '/cloud/bracket-copy',
            modified: 10,
          }),
        ]),
      ],
    })

    registry.configure([
      cloudSyncServiceExtension,
      projectRealizationsExtension,
      cloudSyncPlugin,
    ])
    enableCloudSyncPlugin(registry)

    try {
      await waitFor(() =>
        expect(
          registry.get(cloudProjectRelationshipsService).relationships.value[0]
            ?.duplicateRealizations
        ).toEqual([
          expect.objectContaining({
            autoCleanupEligible: true,
            duplicateRisk: 'exact',
            realization: expect.objectContaining({
              localProjectPath: '/cloud/bracket-copy',
            }),
          }),
        ])
      )
      expect(localProjectManifestMatchesBase).toHaveBeenCalledTimes(1)
      expect(localProjectManifestMatchesBase).toHaveBeenCalledWith(
        expect.objectContaining({
          projectRoot: '/cloud/bracket-copy',
        })
      )
    } finally {
      registry[Symbol.dispose]()
    }
  })

  test('does not eagerly compare directory-library duplicate manifests', async () => {
    cloudSyncStatus.value = {
      enabled: true,
      state: 'idle',
      pendingCount: 0,
    }
    cloudSyncRemoteProjects.value = [
      {
        id: 'remote-123',
        title: 'Remote title',
        revision: 'remote-rev-1',
      },
    ]
    vi.mocked(localProjectManifestMatchesBase).mockClear()
    vi.mocked(localProjectManifestMatchesBase).mockResolvedValue(true)
    const cloudSync = createCloudSyncService()
    vi.mocked(cloudSync.getRemoteProjectThumbnailUrl).mockResolvedValue(
      'https://example.test/remote-123-thumbnail.png'
    )
    vi.mocked(cloudSync.getProjectMetadataIndex).mockResolvedValue(
      new Map([
        [
          '/cloud/bracket',
          {
            schemaVersion: 1,
            localProjectPath: '/cloud/bracket',
            projectName: 'bracket',
            remoteProjectId: 'remote-123',
            hasPendingChanges: false,
            baseManifest: { files: {} },
          },
        ],
        [
          '/files/bracket-copy',
          {
            schemaVersion: 1,
            localProjectPath: '/files/bracket-copy',
            projectName: 'bracket-copy',
            remoteProjectId: 'remote-123',
            hasPendingChanges: false,
            baseManifest: { files: {} },
          },
        ],
      ])
    )
    const registry = new Registry()
    const cloudSyncServiceExtension = defineRegistryItem({
      id: 'test-cloud-sync-service',
      providesServices: [provideService(cloudSyncService, cloudSync)],
    })
    const projectRealizationsExtension = defineRegistryItem({
      id: 'test-project-library-realizations',
      provides: [
        provide(projectLibraryRealizationsValueSpec, [
          projectLibraryRealization({
            libraryType: CLOUD_PROJECT_LIBRARY_TYPE,
            localProjectPath: '/cloud/bracket',
            modified: 20,
          }),
          projectLibraryRealization({
            libraryType: DIRECTORY_PROJECT_LIBRARY_TYPE,
            localProjectPath: '/files/bracket-copy',
            modified: 10,
          }),
        ]),
      ],
    })

    registry.configure([
      cloudSyncServiceExtension,
      projectRealizationsExtension,
      cloudSyncPlugin,
    ])
    enableCloudSyncPlugin(registry)

    try {
      await waitFor(() =>
        expect(
          registry.get(cloudProjectRelationshipsService).relationships.value[0]
            ?.remoteThumbnailUrl
        ).toBe('https://example.test/remote-123-thumbnail.png')
      )
      await Promise.resolve()
      await Promise.resolve()
      expect(
        registry.get(cloudProjectRelationshipsService).relationships.value[0]
          ?.duplicateRealizations
      ).toEqual([
        expect.objectContaining({
          autoCleanupEligible: false,
          duplicateRisk: 'unknown',
          realization: expect.objectContaining({
            localProjectPath: '/files/bracket-copy',
          }),
        }),
      ])
      expect(localProjectManifestMatchesBase).not.toHaveBeenCalled()
    } finally {
      registry[Symbol.dispose]()
    }
  })

  test('marks cloud relationships as conflicted from cloud sync metadata', async () => {
    cloudSyncStatus.value = {
      enabled: true,
      state: 'conflict',
      pendingCount: 0,
      lastFailureAt: new Date(now).toISOString(),
    }
    cloudSyncRemoteProjects.value = [
      {
        id: 'remote-123',
        title: 'Remote title',
        revision: 'remote-rev-2',
        updated_at: '2026-06-02T20:00:00.000Z',
      },
    ]
    const cloudSync = createCloudSyncService()
    vi.mocked(cloudSync.getProjectMetadataIndex).mockResolvedValue(
      new Map([
        [
          '/some/path/local-project',
          {
            schemaVersion: 1,
            localProjectPath: '/some/path/local-project',
            projectName: 'Local project',
            remoteProjectId: 'remote-123',
            remoteRevision: 'remote-rev-1',
            hasPendingChanges: true,
            conflict: {
              conflictProjectPath: '/some/path/local-project (cloud conflict)',
              remoteRevision: 'remote-rev-2',
              createdAt: new Date(now).toISOString(),
            },
          },
        ],
      ])
    )
    const registry = new Registry()
    const cloudSyncServiceExtension = defineRegistryItem({
      id: 'test-cloud-sync-service',
      providesServices: [provideService(cloudSyncService, cloudSync)],
    })

    registry.configure([cloudSyncServiceExtension, cloudSyncPlugin])
    enableCloudSyncPlugin(registry)

    try {
      await waitFor(() =>
        expect(
          registry.get(cloudProjectRelationshipsService).relationships.value
        ).toEqual([
          expect.objectContaining({
            remoteProjectId: 'remote-123',
            canonicalRealization: undefined,
            conflict: expect.objectContaining({
              conflictProjectPath: '/some/path/local-project (cloud conflict)',
            }),
          }),
        ])
      )
    } finally {
      registry[Symbol.dispose]()
    }
  })

  test('adds sync failure metadata for remote upload permission failures', async () => {
    cloudSyncStatus.value = {
      enabled: true,
      state: 'failed',
      pendingCount: 1,
      lastFailure: 'Cloud sync cannot upload local changes.',
      lastFailureKind: 'remote-upload-forbidden',
      lastFailureAt: new Date(now).toISOString(),
    }
    cloudSyncRemoteProjects.value = [
      {
        id: 'remote-123',
        title: 'Remote title',
        revision: 'remote-rev-1',
        updated_at: '2026-06-02T20:00:00.000Z',
      },
    ]
    const cloudSync = createCloudSyncService()
    vi.mocked(cloudSync.getProjectMetadataIndex).mockResolvedValue(
      new Map([
        [
          '/some/path/local-project',
          {
            schemaVersion: 1,
            localProjectPath: '/some/path/local-project',
            projectName: 'Local project',
            remoteProjectId: 'remote-123',
            remoteRevision: 'remote-rev-1',
            hasPendingChanges: true,
            lastFailure: {
              kind: 'remote-upload-forbidden',
              message: 'Cloud sync cannot upload local changes.',
              at: new Date(now).toISOString(),
            },
          },
        ],
      ])
    )
    const registry = new Registry()
    const cloudSyncServiceExtension = defineRegistryItem({
      id: 'test-cloud-sync-service',
      providesServices: [provideService(cloudSyncService, cloudSync)],
    })

    registry.configure([cloudSyncServiceExtension, cloudSyncPlugin])
    enableCloudSyncPlugin(registry)

    try {
      await waitFor(() =>
        expect(
          registry.get(cloudProjectRelationshipsService).relationships.value
        ).toEqual([
          expect.objectContaining({
            remoteProjectId: 'remote-123',
            canonicalRealization: undefined,
            syncFailure: expect.objectContaining({
              kind: 'remote-upload-forbidden',
              message: 'Cloud sync cannot upload local changes.',
            }),
          }),
        ])
      )
    } finally {
      registry[Symbol.dispose]()
    }
  })
})
