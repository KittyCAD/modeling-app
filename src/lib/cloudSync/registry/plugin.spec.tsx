import {
  defineRegistryItem,
  pluginsValueSpec,
  provideService,
  Registry,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import ProjectSidebarMenu from '@src/components/ProjectSidebarMenu'
import type { App } from '@src/lib/app'
import { cloudSyncRemoteProjects, cloudSyncStatus } from '@src/lib/cloudSync'
import {
  cloudSyncPlugin,
  getCloudSyncStatusBarPresentation,
} from '@src/lib/cloudSync/registry/plugin'
import type { Project } from '@src/lib/project'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
  getDefaultCloudProjectLibrarySetting,
  type ProjectLibrarySetting,
} from '@src/lib/projectLibraries'
import type { CloudSyncRegistryService } from '@src/registry/contracts/cloudSync'
import { cloudSyncService } from '@src/registry/contracts/cloudSync'
import { homeProjectEntriesValueSpec } from '@src/registry/contracts/homeProjects'
import {
  projectLibrariesValueSpec,
  projectLibraryTypesValueSpec,
} from '@src/registry/contracts/projectLibraries'
import {
  type SettingsRegistryService,
  settingsService,
} from '@src/registry/contracts/settings'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createActor, createMachine } from 'xstate'

vi.mock('@src/components/CloudConflictDialog', () => ({
  CloudConflictDialog: () => null,
  useCloudSyncProjectConflict: () => undefined,
  useCloudSyncProjectConflicts: () => [],
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

type TestSettings = {
  app: {
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

function createCloudSyncService(): CloudSyncRegistryService {
  return {
    status: signal(cloudSyncStatus.value),
    configure: vi.fn(),
    installFileSystemObserver: vi.fn(),
    retry: vi.fn(),
    setProjectScope: vi.fn(),
    startProjectSync: vi.fn().mockResolvedValue(undefined),
    disconnectProjectSync: vi.fn().mockResolvedValue(undefined),
    ensureProjectLocallySynced: vi.fn().mockResolvedValue(undefined),
    getRemoteProjectThumbnailUrl: vi.fn().mockResolvedValue(undefined),
    getProjectMetadata: vi.fn().mockResolvedValue(undefined),
    getProjectMetadataIndex: vi.fn().mockResolvedValue(new Map()),
    getProjectModifiedTime: vi.fn((_metadata, localModified) => localModified),
    resolveProjectConflict: vi.fn().mockResolvedValue(undefined),
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

function createProjectMenuApp(cloudSync: CloudSyncRegistryService) {
  const registry = new Registry()
  const cloudSyncServiceExtension = defineRegistryItem({
    id: 'test-cloud-sync-service',
    providesServices: [provideService(cloudSyncService, cloudSync)],
  })
  registry.configure([cloudSyncServiceExtension, cloudSyncPlugin])
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
        useSettings: () => ({
          app: {
            machineApi: {
              current: false,
            },
          },
        }),
      },
      registry,
    } as unknown as App,
    dispose: () => {
      commandsActor.stop()
      registry[Symbol.dispose]()
    },
  }
}

afterEach(() => {
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

describe('cloud sync project menu item', () => {
  test('starts cloud sync for a local-only project from the project sidebar menu', async () => {
    cloudSyncStatus.value = {
      enabled: true,
      state: 'idle',
      pendingCount: 0,
    }
    const cloudSync = createCloudSyncService()
    const { app, dispose } = createProjectMenuApp(cloudSync)

    try {
      renderWithRouter(
        <ProjectSidebarMenu app={app} enableMenu project={projectWellFormed} />
      )

      fireEvent.click(screen.getByTestId('project-sidebar-toggle'))
      fireEvent.click(
        await screen.findByTestId('project-sidebar-start-cloud-sync')
      )

      await waitFor(() =>
        expect(cloudSync.startProjectSync).toHaveBeenCalledWith(
          projectWellFormed.path
        )
      )
    } finally {
      dispose()
    }
  })

  test('offers to stop syncing for a cloud-linked project', async () => {
    cloudSyncStatus.value = {
      enabled: true,
      state: 'idle',
      pendingCount: 0,
    }
    const cloudSync = createCloudSyncService()
    const { app, dispose } = createProjectMenuApp(cloudSync)

    try {
      renderWithRouter(
        <ProjectSidebarMenu
          app={app}
          enableMenu
          project={{
            ...projectWellFormed,
            cloudProjectId: 'project-123',
          }}
        />
      )

      fireEvent.click(screen.getByTestId('project-sidebar-toggle'))

      expect(
        await screen.findByTestId('project-sidebar-disconnect-cloud-sync')
      ).toHaveTextContent('Stop syncing...')
    } finally {
      dispose()
    }
  })
})

describe('cloud sync project library', () => {
  test('contributes the cloud project library type while the plugin is active', () => {
    const registry = new Registry()
    registry.configure([cloudSyncPlugin])

    try {
      expect(
        registry
          .get(projectLibraryTypesValueSpec)
          .get(CLOUD_PROJECT_LIBRARY_TYPE)
      ).toMatchObject({
        title: 'Cloud',
        icon: 'network',
        defaultSetting: getDefaultCloudProjectLibrarySetting(),
      })
      expect(registry.get(projectLibrariesValueSpec)).toEqual([
        expect.objectContaining({
          id: PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
          title: 'Personal Cloud',
          path: getDefaultCloudProjectLibrarySetting().path,
          type: CLOUD_PROJECT_LIBRARY_TYPE,
          icon: 'network',
        }),
      ])

      const plugin = registry
        .get(pluginsValueSpec)
        .find((plugin) => plugin.id === CLOUD_SYNC_PLUGIN_ID)
      const pluginService = plugin?.service
      expect(pluginService).toBeDefined()
      if (!pluginService) {
        return
      }

      registry.get(pluginService).disable()

      expect(
        registry
          .get(projectLibraryTypesValueSpec)
          .has(CLOUD_PROJECT_LIBRARY_TYPE)
      ).toBe(false)
      expect(registry.get(projectLibrariesValueSpec)).toEqual([])
    } finally {
      registry[Symbol.dispose]()
    }
  })

  test('preserves configured personal cloud library order', () => {
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
      expect(registry.get(projectLibrariesValueSpec)).toEqual([
        expect.objectContaining({
          id: PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
          order: 1,
        }),
      ])
    } finally {
      registry[Symbol.dispose]()
    }
  })

  test('adds the default cloud library to user settings when enabled', async () => {
    const registry = new Registry()
    const settings = createSettingsService({})
    const settingsExtension = defineRegistryItem({
      id: 'test-settings-service',
      providesServices: [provideService(settingsService, settings.service)],
    })

    registry.configure([settingsExtension, cloudSyncPlugin])

    try {
      registry.get(projectLibraryTypesValueSpec)
      await waitFor(() =>
        expect(settings.send).toHaveBeenCalledWith({
          type: 'set.app.libraries',
          data: {
            level: 'user',
            value: [getDefaultCloudProjectLibrarySetting()],
          },
        })
      )
      expect(settings.settingsSignal.value.app.libraries.current).toEqual([
        getDefaultCloudProjectLibrarySetting(),
      ])
    } finally {
      registry[Symbol.dispose]()
    }
  })

  test('does not add the default cloud library when settings disable the plugin', async () => {
    const registry = new Registry()
    const settings = createSettingsService({ cloudSyncEnabled: false })
    const settingsExtension = defineRegistryItem({
      id: 'test-settings-service',
      providesServices: [provideService(settingsService, settings.service)],
    })

    registry.configure([settingsExtension, cloudSyncPlugin])

    try {
      registry.get(projectLibraryTypesValueSpec)
      await Promise.resolve()
      await Promise.resolve()
      expect(settings.send).not.toHaveBeenCalled()
      expect(settings.settingsSignal.value.app.libraries.current).toEqual([])
    } finally {
      registry[Symbol.dispose]()
    }
  })
})

describe('cloud sync home project entries', () => {
  test('contributes remote thumbnails for cloud-only home entries', async () => {
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

    try {
      await waitFor(() =>
        expect(registry.get(homeProjectEntriesValueSpec)).toEqual([
          expect.objectContaining({
            source: 'remote',
            status: 'cloud-only',
            libraryIds: [PERSONAL_CLOUD_PROJECT_LIBRARY_ID],
            name: 'Remote title',
            title: 'Remote title',
            remoteProjectId: 'remote-123',
            thumbnail: {
              type: 'remote',
              url: 'https://example.test/remote-123-thumbnail.png',
            },
          }),
        ])
      )
    } finally {
      registry[Symbol.dispose]()
    }
  })

  test('marks home entries with both sources as conflicted from cloud sync metadata', async () => {
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

    try {
      await waitFor(() =>
        expect(registry.get(homeProjectEntriesValueSpec)).toEqual([
          expect.objectContaining({
            source: 'remote',
            status: 'conflicted',
            name: 'Local project',
            title: 'Local project',
            remoteProjectId: 'remote-123',
            localProjectPath: '/some/path/local-project',
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

    try {
      await waitFor(() =>
        expect(registry.get(homeProjectEntriesValueSpec)).toEqual([
          expect.objectContaining({
            source: 'remote',
            status: 'cloud-only',
            name: 'Local project',
            title: 'Local project',
            remoteProjectId: 'remote-123',
            localProjectPath: '/some/path/local-project',
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
