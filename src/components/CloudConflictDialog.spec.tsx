import { CloudConflictDialog } from '@src/components/CloudConflictDialog'
import {
  loadCloudSyncProjectConflictInspection,
  resolveCloudSyncProjectConflict,
} from '@src/lib/cloudSync'
import { Themes } from '@src/lib/theme'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

const cloudConflictDialogSpecMocks = vi.hoisted(() => {
  const encoder = new TextEncoder()
  const localSavedAtMs = Date.parse('2026-07-17T11:00:00.000Z')
  const cloudSavedAtMs = Date.parse('2026-07-17T12:00:00.000Z')

  function inspectedFile(
    relativePath: string,
    contents: string,
    modifiedAtMs: number
  ) {
    const data = encoder.encode(contents)
    return {
      absolutePath: relativePath,
      data,
      modifiedAtMs,
      relativePath,
      size: data.byteLength,
    }
  }

  function inspectedBinaryFile(relativePath: string, modifiedAtMs: number) {
    return {
      absolutePath: relativePath,
      data: new Uint8Array([0, 1, 2]),
      modifiedAtMs,
      relativePath,
      size: 3,
    }
  }

  return {
    inspection: {
      projectTitle: 'User-facing project title',
      remoteProjectId: 'remote-123',
      remoteRevision: 'remote-revision-2',
      localSavedAtMs,
      cloudSavedAtMs,
      changedFiles: [
        {
          status: 'changed',
          relativePath: 'main.kcl',
          local: inspectedFile('main.kcl', 'x = 1\n', localSavedAtMs),
          cloud: inspectedFile('main.kcl', 'x = 2\n', cloudSavedAtMs),
          localText: 'x = 1\n',
          cloudText: 'x = 2\n',
        },
        {
          status: 'local-only',
          relativePath: 'local-only.txt',
          local: inspectedFile('local-only.txt', 'local\n', localSavedAtMs),
          localText: 'local\n',
          cloudText: '',
        },
        {
          status: 'cloud-only',
          relativePath: 'cloud-only.txt',
          cloud: inspectedFile('cloud-only.txt', 'cloud\n', cloudSavedAtMs),
          localText: '',
          cloudText: 'cloud\n',
        },
        {
          status: 'changed',
          relativePath: 'thumbnail.png',
          local: inspectedBinaryFile('thumbnail.png', localSavedAtMs),
          cloud: inspectedBinaryFile('thumbnail.png', cloudSavedAtMs),
          textUnavailableReason: 'Binary or non-UTF-8 file.',
        },
      ],
    },
  }
})

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
        createdAt: '2026-07-17T12:00:00.000Z',
        remoteRevision: 'remote-revision-2',
      },
    }),
    getCloudSyncProjectMetadataIndex: vi.fn().mockResolvedValue(new Map()),
    isCloudSyncConflictRevisionChangedError: vi.fn(
      (error: unknown) =>
        error instanceof Error &&
        error.name === 'CloudSyncConflictRevisionChangedError'
    ),
    loadCloudSyncProjectConflictInspection: vi
      .fn()
      .mockResolvedValue(cloudConflictDialogSpecMocks.inspection),
    resolveCloudSyncProjectConflict: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock('@src/lib/fs-zds', () => ({
  default: {
    extname: (path: string) => {
      const dotIndex = path.lastIndexOf('.')
      return dotIndex === -1 ? '' : path.slice(dotIndex)
    },
    join: (...parts: string[]) =>
      parts
        .reduce((left, right) => (left ? `${left}/${right}` : right), '')
        .replaceAll(/\/+/g, '/'),
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

describe('CloudConflictDialog', () => {
  test('shows changed files with expanded diffs and resolution actions', async () => {
    const onDismiss = vi.fn()

    render(
      <CloudConflictDialog
        projectPath="/projects/local"
        projectName="local-folder"
        resolvedTheme={Themes.Light}
        onDismiss={onDismiss}
      />
    )

    expect(await screen.findByText('main.kcl')).toBeInTheDocument()
    const intro = screen.getByText(/Local and cloud data both changed for/)
    expect(intro).toHaveTextContent('"User-facing project title"')
    expect(screen.getByText('cloud ID: remote-123')).toBeInTheDocument()
    expect(intro).not.toHaveTextContent('local-folder')
    expect(screen.getAllByText('main.kcl')).not.toHaveLength(0)
    expect(screen.getAllByText('local-only.txt')).not.toHaveLength(0)
    expect(screen.getAllByText('cloud-only.txt')).not.toHaveLength(0)
    expect(screen.getByText('thumbnail.png')).toBeInTheDocument()
    expect(screen.queryByText('.git')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('mock-merge-view')).toHaveLength(3)
    expect(
      screen.queryByText('Diff unavailable: Binary or non-UTF-8 file.')
    ).not.toBeInTheDocument()
    expect(screen.getByText(/Upload local project/)).toBeInTheDocument()
    expect(screen.getByText(/Replace local project/)).toBeInTheDocument()
    expect(
      screen
        .getByTestId('use-local-data')
        .querySelector('svg[aria-label="folder"]')
    ).toBeInTheDocument()
    expect(
      screen
        .getByTestId('use-cloud-data')
        .querySelector('svg[aria-label="cloud"]')
    ).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('cloud-conflict-file-toggle-main.kcl'))
    expect(screen.getAllByTestId('mock-merge-view')).toHaveLength(2)

    fireEvent.click(
      screen.getByTestId('cloud-conflict-file-toggle-thumbnail.png')
    )
    expect(
      screen.getByText('Diff unavailable: Binary or non-UTF-8 file.')
    ).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('cloud-conflict-close-button'))
    expect(onDismiss).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('use-local-data'))
    await waitFor(() =>
      expect(resolveCloudSyncProjectConflict).toHaveBeenCalledWith(
        '/projects/local',
        'local',
        'remote-revision-2'
      )
    )

    expect(loadCloudSyncProjectConflictInspection).toHaveBeenCalledWith(
      '/projects/local'
    )
  })
})
