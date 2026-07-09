import {
  Registry,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createActor, createMachine } from 'xstate'

import ProjectSidebarMenu from '@src/components/ProjectSidebarMenu'
import { cloudSyncRemoteProjects, cloudSyncStatus } from '@src/lib/cloudSync'
import { cloudSyncPlugin } from '@src/lib/cloudSync/registry/plugin'
import type { CloudSyncRegistryService } from '@src/registry/contracts/cloudSync'
import { cloudSyncService } from '@src/registry/contracts/cloudSync'
import { homeProjectEntriesValueSpec } from '@src/registry/contracts/homeProjects'
import type { App } from '@src/lib/app'
import type { Project } from '@src/lib/project'

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
    getProjectMetadata: vi.fn().mockResolvedValue(undefined),
    getProjectMetadataIndex: vi.fn().mockResolvedValue(new Map()),
    getProjectModifiedTime: vi.fn((_metadata, localModified) => localModified),
    resolveProjectConflict: vi.fn().mockResolvedValue(undefined),
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

describe('cloud sync home project entries', () => {
  test('marks merged home entries as conflicted from cloud sync metadata', async () => {
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
