import { CloudConflictDialog } from '@src/components/CloudConflictDialog'
import fsZds from '@src/lib/fs-zds'
import {
  getCloudSyncProjectMetadata,
  resolveCloudSyncProjectConflict,
} from '@src/lib/cloudSync'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

vi.mock('@codemirror/merge', () => ({
  MergeView: class MergeView {
    dom: HTMLDivElement

    constructor({ parent }: { parent: Element }) {
      this.dom = document.createElement('div')
      this.dom.dataset.testid = 'mock-merge-view'
      parent.appendChild(this.dom)
    }

    destroy() {
      this.dom.remove()
    }
  },
}))

vi.mock('@src/lib/boot', () => ({
  useApp: () => ({
    settings: {
      useSettings: () => ({
        app: {
          theme: {
            current: 'light',
          },
        },
      }),
    },
  }),
}))

vi.mock('@src/lib/cloudSync', async () => {
  const { signal } = await import('@preact/signals-core')

  return {
    cloudSyncStatus: signal({
      enabled: true,
      state: 'conflict',
      pendingCount: 0,
    }),
    getCloudSyncProjectMetadata: vi.fn().mockResolvedValue({
      schemaVersion: 1,
      localProjectPath: '/projects/local',
      projectName: 'Local project',
      remoteProjectId: 'remote-123',
      conflict: {
        conflictProjectPath: '/projects/local (cloud conflict)',
        createdAt: '2026-07-17T12:00:00.000Z',
        remoteRevision: 'remote-revision-2',
      },
    }),
    getCloudSyncProjectMetadataIndex: vi.fn().mockResolvedValue(new Map()),
    resolveCloudSyncProjectConflict: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock('@src/lib/fs-zds', () => ({
  default: {
    extname: (path: string) => {
      const dotIndex = path.lastIndexOf('.')
      return dotIndex === -1 ? '' : path.slice(dotIndex)
    },
    join: (...parts: string[]) => parts.join('/').replaceAll(/\/+/g, '/'),
    relative: (root: string, path: string) =>
      path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path,
    readdir: vi.fn(),
    readFile: vi.fn(),
    stat: vi.fn(),
  },
}))

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const encoder = new TextEncoder()

function fileStat(mtimeMs: number) {
  return {
    mode: 0,
    mtimeMs,
  }
}

function directoryStat() {
  return {
    mode: 0x4000,
    mtimeMs: 0,
  }
}

describe('CloudConflictDialog', () => {
  test('shows conflict summary, changed files, merge views, and resolution actions', async () => {
    vi.mocked(fsZds.readdir).mockImplementation(async (path) => {
      if (path === '/projects/local') {
        return ['main.kcl', 'local-only.txt']
      }
      if (path === '/projects/local (cloud conflict)') {
        return ['main.kcl', 'cloud-only.txt']
      }
      return []
    })
    vi.mocked(fsZds.stat).mockImplementation(async (path) => {
      if (
        path === '/projects/local' ||
        path === '/projects/local (cloud conflict)'
      ) {
        return directoryStat() as never
      }
      if (path.includes('cloud-only')) {
        return fileStat(Date.parse('2026-07-17T12:00:00.000Z')) as never
      }
      return fileStat(Date.parse('2026-07-17T11:00:00.000Z')) as never
    })
    vi.mocked(fsZds.readFile).mockImplementation(async (path) => {
      if (path === '/projects/local/main.kcl') {
        return encoder.encode('x = 1\n')
      }
      if (path === '/projects/local (cloud conflict)/main.kcl') {
        return encoder.encode('x = 2\n')
      }
      if (path === '/projects/local/local-only.txt') {
        return encoder.encode('local\n')
      }
      return encoder.encode('cloud\n')
    })
    const onDismiss = vi.fn()

    render(
      <CloudConflictDialog
        projectPath="/projects/local"
        projectName="Local project"
        onDismiss={onDismiss}
      />
    )

    expect(await screen.findByText('remote-revision-2')).toBeInTheDocument()
    expect(screen.getAllByText('main.kcl')).not.toHaveLength(0)
    expect(screen.getAllByText('local-only.txt')).not.toHaveLength(0)
    expect(screen.getAllByText('cloud-only.txt')).not.toHaveLength(0)
    expect(screen.getAllByTestId('mock-merge-view')).toHaveLength(3)

    fireEvent.click(screen.getByTestId('cloud-conflict-close-button'))
    expect(onDismiss).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('use-local-data'))
    await waitFor(() =>
      expect(resolveCloudSyncProjectConflict).toHaveBeenCalledWith(
        '/projects/local',
        'local'
      )
    )

    expect(getCloudSyncProjectMetadata).toHaveBeenCalledWith('/projects/local')
  })
})
