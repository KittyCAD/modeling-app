import {
  defineRegistryItem,
  provideService,
  Registry,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import ProjectSidebarMenu from '@src/components/ProjectSidebarMenu'
import type { App } from '@src/lib/app'
import { cloudSyncRemoteProjects, cloudSyncStatus } from '@src/lib/cloudSync'
import { cloudSyncPlugin } from '@src/lib/cloudSync/registry/plugin'
import type { Project } from '@src/lib/project'
import {
  CLOUD_PROJECT_LIBRARY_ID,
  DEFAULT_CLOUD_PROJECT_LIBRARY_PATH,
  getDefaultProjectLibrarySettings,
  type ProjectLibrarySetting,
} from '@src/lib/projectLibraries'
import {
  createSettings,
  type SettingsType,
} from '@src/lib/settings/initialSettings'
import type { CloudSyncRegistryService } from '@src/registry/contracts/cloudSync'
import { cloudSyncService } from '@src/registry/contracts/cloudSync'
import { homeProjectEntriesValueSpec } from '@src/registry/contracts/homeProjects'
import { projectLibrariesValueSpec } from '@src/registry/contracts/projectLibraries'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'
import { settingsService } from '@src/registry/contracts/settings'
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

function createSettingsRegistryService(settings = createSettings()) {
  const current = signal<SettingsType>(settings)
  const send = vi.fn(
    (event: Parameters<SettingsRegistryService['send']>[0]) => {
      if (event.type !== 'set.app.libraries') {
        return
      }

      current.value.app.libraries.user = event.data
        .value as ProjectLibrarySetting[]
      current.value = {
        ...current.value,
        app: {
          ...current.value.app,
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
    current,
    get: () => current.value,
    send,
    useSettings: () => current.value,
  } as unknown as SettingsRegistryService

  return { service, send }
}

function createSettingsServiceExtension(settings: SettingsRegistryService) {
  return defineRegistryItem({
    id: 'test-settings-service',
    providesServices: [provideService(settingsService, settings)],
  })
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

describe('cloud sync library settings lifecycle', () => {
  test('adds the default cloud library when library settings have not been customized', async () => {
    const settingsSnapshot = createSettings()
    settingsSnapshot.app.libraries.default =
      getDefaultProjectLibrarySettings('/projects')
    const { service: settings, send } =
      createSettingsRegistryService(settingsSnapshot)
    const cloudSync = createCloudSyncService()
    const registry = new Registry()
    const cloudSyncServiceExtension = defineRegistryItem({
      id: 'test-cloud-sync-service',
      providesServices: [provideService(cloudSyncService, cloudSync)],
    })

    registry.configure([
      cloudSyncServiceExtension,
      createSettingsServiceExtension(settings),
      cloudSyncPlugin,
    ])
    registry.inspect()

    try {
      await waitFor(() =>
        expect(send).toHaveBeenCalledWith({
          type: 'set.app.libraries',
          data: {
            level: 'user',
            value: [
              {
                title: 'Default Projects Directory',
                path: '/projects',
                type: 'directory',
              },
              {
                title: 'Cloud',
                path: DEFAULT_CLOUD_PROJECT_LIBRARY_PATH,
                type: 'cloud',
              },
            ],
          },
        })
      )
    } finally {
      registry[Symbol.dispose]()
    }
  })

  test('adds the default cloud library after library settings have been customized', async () => {
    const settingsSnapshot = createSettings()
    settingsSnapshot.app.libraries.default =
      getDefaultProjectLibrarySettings('/projects')
    settingsSnapshot.app.libraries.user = []
    const { service: settings, send } =
      createSettingsRegistryService(settingsSnapshot)
    const cloudSync = createCloudSyncService()
    const registry = new Registry()
    const cloudSyncServiceExtension = defineRegistryItem({
      id: 'test-cloud-sync-service',
      providesServices: [provideService(cloudSyncService, cloudSync)],
    })

    registry.configure([
      cloudSyncServiceExtension,
      createSettingsServiceExtension(settings),
      cloudSyncPlugin,
    ])
    registry.inspect()

    try {
      await waitFor(() =>
        expect(send).toHaveBeenCalledWith({
          type: 'set.app.libraries',
          data: {
            level: 'user',
            value: [
              {
                title: 'Cloud',
                path: DEFAULT_CLOUD_PROJECT_LIBRARY_PATH,
                type: 'cloud',
              },
            ],
          },
        })
      )
    } finally {
      registry[Symbol.dispose]()
    }
  })

  test('does not duplicate an existing cloud library with the same type and path', async () => {
    const settingsSnapshot = createSettings()
    settingsSnapshot.app.libraries.default =
      getDefaultProjectLibrarySettings('/projects')
    settingsSnapshot.app.libraries.user = [
      {
        title: 'Renamed Cloud',
        path: DEFAULT_CLOUD_PROJECT_LIBRARY_PATH,
        type: 'cloud',
      },
    ]
    const { service: settings, send } =
      createSettingsRegistryService(settingsSnapshot)
    const cloudSync = createCloudSyncService()
    const registry = new Registry()
    const cloudSyncServiceExtension = defineRegistryItem({
      id: 'test-cloud-sync-service',
      providesServices: [provideService(cloudSyncService, cloudSync)],
    })

    registry.configure([
      cloudSyncServiceExtension,
      createSettingsServiceExtension(settings),
      cloudSyncPlugin,
    ])
    registry.inspect()

    try {
      await new Promise<void>((resolve) => queueMicrotask(resolve))
      expect(send).not.toHaveBeenCalled()
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
      expect(registry.get(projectLibrariesValueSpec)).toEqual([
        expect.objectContaining({
          id: CLOUD_PROJECT_LIBRARY_ID,
          title: 'Cloud',
        }),
      ])

      await waitFor(() =>
        expect(registry.get(homeProjectEntriesValueSpec)).toEqual([
          expect.objectContaining({
            source: 'remote',
            status: 'cloud-only',
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
})
