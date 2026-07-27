import AppProjectCard from '@src/components/AppProjectCard/AppProjectCard'
import fsZds from '@src/lib/fs-zds'
import type {
  HomeProjectActionsService,
  HomeProjectEntry,
} from '@src/registry/contracts/homeProjects'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@src/lib/fs-zds', () => ({
  default: {
    join: (...parts: string[]) =>
      parts.reduce((left, right) => (left ? `${left}/${right}` : right), ''),
    stat: vi.fn().mockResolvedValue({}),
    readFile: vi.fn().mockResolvedValue(new Uint8Array()),
  },
}))

const now = Date.now()
let createObjectURLMock: ReturnType<typeof vi.fn>
let revokeObjectURLMock: ReturnType<typeof vi.fn>
const cloudProject = {
  id: 'remote:project-123',
  name: 'old-cloud-title',
  title: 'Old cloud title',
  source: 'local',
  status: 'synced',
  remoteProjectId: 'project-123',
  localProjectPath: '/projects/old-cloud-title',
  localProjectName: 'old-cloud-title',
  readWriteAccess: true,
  modified: now,
  thumbnail: {
    type: 'local',
    path: '/projects/old-cloud-title/thumbnail.png',
  },
  kclFileCount: 1,
  directoryCount: 0,
  defaultFile: '/projects/old-cloud-title/main.kcl',
} satisfies HomeProjectEntry

function createProjectActions({
  canOpen = vi.fn(() => true),
  rename = vi.fn().mockResolvedValue(undefined),
}: {
  canOpen?: HomeProjectActionsService['canOpen']
  rename?: HomeProjectActionsService['rename']
} = {}): HomeProjectActionsService {
  return {
    canOpen,
    canRename: () => true,
    canDelete: () => true,
    open: vi.fn().mockResolvedValue({
      defaultFile: '/projects/old-cloud-title/main.kcl',
    }),
    rename,
    delete: vi.fn().mockResolvedValue(undefined),
  }
}

function renderProjectCard({
  project = cloudProject,
  projectActions = createProjectActions(),
  showCloudSyncUi,
}: {
  project?: HomeProjectEntry
  projectActions?: HomeProjectActionsService
  showCloudSyncUi?: boolean
} = {}) {
  render(
    <BrowserRouter>
      <AppProjectCard
        project={project}
        projectActions={projectActions}
        showCloudSyncUi={showCloudSyncUi}
      />
    </BrowserRouter>
  )

  return { projectActions }
}

function clickRenameProject() {
  fireEvent.contextMenu(screen.getByTestId('project-link'))
  fireEvent.click(screen.getByTestId('project-card-context-rename'))
}

function submitRenameProject() {
  const renameForm = screen.getByTestId('project-rename-input').closest('form')
  expect(renameForm).not.toBeNull()
  if (!renameForm) {
    return
  }

  fireEvent.submit(renameForm)
}

describe('ProjectCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fsZds.readFile).mockResolvedValue(new Uint8Array())
    createObjectURLMock = vi.fn(() => 'blob:thumbnail')
    revokeObjectURLMock = vi.fn()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: createObjectURLMock,
      revokeObjectURL: revokeObjectURLMock,
    })
  })

  test('eagerly shows cloud project renames while sync continues', async () => {
    const rename = vi.fn().mockResolvedValue(undefined)
    const { projectActions } = renderProjectCard({
      projectActions: createProjectActions({ rename }),
    })

    expect(screen.getByTestId('project-title')).toHaveTextContent(
      'Old cloud title'
    )

    clickRenameProject()
    fireEvent.change(screen.getByTestId('project-rename-input'), {
      target: { value: 'New cloud title' },
    })
    submitRenameProject()

    await waitFor(() => expect(projectActions.rename).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.getByTestId('project-title')).toHaveTextContent(
        'New cloud title'
      )
    )
  })

  test('eagerly shows local project title renames', async () => {
    const localProject = {
      ...cloudProject,
      id: 'local:/projects/local-folder',
      name: 'local-folder',
      title: 'Old local title',
      source: 'local',
      status: 'local',
      remoteProjectId: undefined,
      localProjectPath: '/projects/local-folder',
      localProjectName: 'local-folder',
      defaultFile: '/projects/local-folder/main.kcl',
    } satisfies HomeProjectEntry
    const rename = vi.fn().mockResolvedValue(undefined)
    const { projectActions } = renderProjectCard({
      project: localProject,
      projectActions: createProjectActions({ rename }),
    })

    expect(screen.getByTestId('project-title')).toHaveTextContent(
      'Old local title'
    )

    clickRenameProject()
    fireEvent.change(screen.getByTestId('project-rename-input'), {
      target: { value: '.New local title' },
    })
    submitRenameProject()

    await waitFor(() =>
      expect(projectActions.rename).toHaveBeenCalledWith(
        localProject,
        '.New local title'
      )
    )
    await waitFor(() =>
      expect(screen.getByTestId('project-title')).toHaveTextContent(
        '.New local title'
      )
    )
  })

  test('shows status badges for project cards with one source', () => {
    renderProjectCard({
      project: {
        ...cloudProject,
        id: 'local:/projects/local-title',
        name: 'local-title',
        title: 'Local title',
        status: 'local',
        remoteProjectId: undefined,
      },
    })

    expect(screen.getByTestId('project-status-badge')).toHaveTextContent(
      'Local'
    )
  })

  test('shows cloud-only status badges for remote project cards', () => {
    renderProjectCard({
      project: {
        ...cloudProject,
        source: 'remote',
        status: 'cloud-only',
        localProjectPath: undefined,
        localProjectName: undefined,
        defaultFile: undefined,
        kclFileCount: undefined,
        directoryCount: undefined,
      },
    })

    expect(screen.getByTestId('project-status-badge')).toHaveTextContent(
      'Cloud-only'
    )
  })

  test('does not show status badges for cards with both local and remote sources', () => {
    renderProjectCard({
      project: {
        ...cloudProject,
        source: 'both',
      },
    })

    expect(screen.queryByTestId('project-status-badge')).not.toBeInTheDocument()
  })

  test('hides cloud sync project chips when cloud sync UI is disabled', () => {
    renderProjectCard({
      showCloudSyncUi: false,
      project: {
        ...cloudProject,
        status: 'conflicted',
        conflict: {
          conflictProjectPath: '/projects/old-cloud-title conflict',
          createdAt: new Date(now).toISOString(),
          remoteRevision: 'revision-123',
        },
      },
    })

    expect(screen.queryByTestId('project-status-badge')).not.toBeInTheDocument()
    expect(screen.queryByTestId('cloud-conflict-badge')).not.toBeInTheDocument()
  })

  test('shows project actions in the card context menu', () => {
    renderProjectCard()

    expect(screen.queryByText('Rename project')).not.toBeInTheDocument()
    expect(screen.queryByText('Delete project')).not.toBeInTheDocument()

    fireEvent.contextMenu(screen.getByTestId('project-link'))

    expect(screen.getByTestId('project-card-context-rename')).toHaveTextContent(
      'Rename project'
    )
    expect(screen.getByTestId('project-card-context-delete')).toHaveTextContent(
      'Delete project'
    )
  })

  test('selects the project title when opening rename from the context menu', async () => {
    renderProjectCard()

    clickRenameProject()

    const input = screen.getByTestId('project-rename-input')
    if (!(input instanceof HTMLInputElement)) {
      expect(input).toBeInstanceOf(HTMLInputElement)
      return
    }

    await waitFor(() => expect(input).toHaveFocus())

    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(input.value.length)
  })

  test('shows cloud sync blocked badge for upload permission failures', () => {
    renderProjectCard({
      project: {
        ...cloudProject,
        source: 'both',
        syncFailure: {
          kind: 'remote-upload-forbidden',
          message: 'Cloud sync cannot upload local changes.',
          at: new Date(now).toISOString(),
        },
      },
    })

    expect(screen.getByTestId('cloud-sync-blocked-badge')).toHaveTextContent(
      'Cloud sync blocked'
    )
    expect(screen.queryByTestId('project-status-badge')).not.toBeInTheDocument()
  })

  test('shows cloud sync blocked badge for upload permission failures', () => {
    renderProjectCard({
      project: {
        ...cloudProject,
        source: 'both',
        syncFailure: {
          kind: 'remote-upload-forbidden',
          message: 'Cloud sync cannot upload local changes.',
          at: new Date(now).toISOString(),
        },
      },
    })

    expect(screen.getByTestId('cloud-sync-blocked-badge')).toHaveTextContent(
      'Cloud sync blocked'
    )
    expect(screen.queryByTestId('project-status-badge')).not.toBeInTheDocument()
  })

  test('keeps local thumbnail object URLs stable when the project object changes', async () => {
    vi.mocked(fsZds.readFile).mockResolvedValue(new Uint8Array([1, 2, 3]))
    const projectActions = createProjectActions()
    const { rerender } = render(
      <BrowserRouter>
        <AppProjectCard
          project={cloudProject}
          projectActions={projectActions}
        />
      </BrowserRouter>
    )

    await waitFor(() => expect(fsZds.readFile).toHaveBeenCalledTimes(1))
    expect(createObjectURLMock).toHaveBeenCalledTimes(1)

    rerender(
      <BrowserRouter>
        <AppProjectCard
          project={{
            ...cloudProject,
            modified: now + 1,
            thumbnail: {
              type: 'local',
              path: '/projects/old-cloud-title/thumbnail.png',
            },
          }}
          projectActions={projectActions}
        />
      </BrowserRouter>
    )

    expect(fsZds.readFile).toHaveBeenCalledTimes(1)
    expect(createObjectURLMock).toHaveBeenCalledTimes(1)
    expect(revokeObjectURLMock).not.toHaveBeenCalled()
  })

  test('eagerly shows cloud project rename modified time while sync continues', async () => {
    const project = {
      ...cloudProject,
      modified: 1,
    }
    const rename = vi.fn().mockResolvedValue(undefined)
    const { projectActions } = renderProjectCard({
      project,
      projectActions: createProjectActions({ rename }),
    })
    const previousEditedTime =
      screen.getByTestId('project-edit-date').textContent

    clickRenameProject()
    fireEvent.change(screen.getByTestId('project-rename-input'), {
      target: { value: 'New cloud title' },
    })
    submitRenameProject()

    await waitFor(() => expect(projectActions.rename).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.getByTestId('project-edit-date')).not.toHaveTextContent(
        previousEditedTime ?? ''
      )
    )
  })

  test('opens conflicted project cards without resolving cloud conflicts on Home', async () => {
    const project = {
      ...cloudProject,
      status: 'conflicted',
      conflict: {
        conflictProjectPath: '/projects/old-cloud-title conflict',
        createdAt: new Date(now).toISOString(),
        remoteRevision: 'revision-123',
      },
    } satisfies HomeProjectEntry
    const { projectActions } = renderProjectCard({
      project,
    })

    expect(screen.getByTestId('cloud-conflict-badge')).toHaveTextContent(
      'Cloud conflict'
    )

    fireEvent.click(screen.getByTestId('project-link'))

    await waitFor(() =>
      expect(projectActions.open).toHaveBeenCalledWith(project)
    )
    expect(
      screen.queryByTestId('cloud-conflict-dialog')
    ).not.toBeInTheDocument()
  })

  test('does not make conflict-only project cards openable from Home', () => {
    const projectActions = createProjectActions()
    vi.mocked(projectActions.canOpen).mockReturnValue(false)
    renderProjectCard({
      projectActions,
      project: {
        ...cloudProject,
        status: 'conflicted',
        defaultFile: undefined,
        conflict: {
          conflictProjectPath: '/projects/old-cloud-title conflict',
          createdAt: new Date(now).toISOString(),
          remoteRevision: 'revision-123',
        },
      },
    })

    expect(screen.getByTestId('cloud-conflict-badge')).toHaveTextContent(
      'Cloud conflict'
    )

    fireEvent.click(screen.getByTestId('project-link'))

    expect(projectActions.open).not.toHaveBeenCalled()
    expect(
      screen.queryByTestId('cloud-conflict-dialog')
    ).not.toBeInTheDocument()
  })
})
