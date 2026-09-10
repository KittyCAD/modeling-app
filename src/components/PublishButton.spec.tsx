import type { ProjectPublishSubmission, PublishedProject } from '@src/lib/share'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

type PublishDialogTestProps = {
  onSubmit: (
    submission: ProjectPublishSubmission
  ) => Promise<boolean | PublishedProject>
  willMoveProjectToCloud: boolean
}

const mockState = vi.hoisted(() => ({
  useProjectStatus: vi.fn(),
  publishCurrentProject: vi.fn(),
  getCurrentProjectPublicationDetails: vi.fn(),
  writeProjectTitleToProjectToml: vi.fn(),
  publishDialogProps: null as PublishDialogTestProps | null,
}))

vi.mock('@src/hooks/useProjectStatus', () => ({
  useProjectStatus: mockState.useProjectStatus,
}))

vi.mock('@src/lib/share', () => ({
  publishCurrentProject: mockState.publishCurrentProject,
  getCurrentProjectPublicationDetails:
    mockState.getCurrentProjectPublicationDetails,
}))

vi.mock('@src/lib/desktop', () => ({
  writeProjectTitleToProjectToml: mockState.writeProjectTitleToProjectToml,
}))

vi.mock('@src/components/PublishDialog', () => ({
  PublishDialog: (props: PublishDialogTestProps) => {
    mockState.publishDialogProps = props
    return <div data-testid="publish-dialog" />
  },
}))

import { PublishButton } from '@src/components/PublishButton'
import type { App } from '@src/lib/app'
import { cloudSyncService } from '@src/lib/cloudSync/registry/contract'
import type { Project } from '@src/lib/project'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  DIRECTORY_PROJECT_LIBRARY_TYPE,
} from '@src/lib/projectLibraries'
import type {
  HomeProjectActionsService,
  HomeProjectEntry,
  HomeProjectMoveToLibraryTarget,
} from '@src/registry/contracts/homeProjects'
import {
  homeProjectActionsService,
  homeProjectEntriesValueSpec,
} from '@src/registry/contracts/homeProjects'
import { MemoryRouter } from 'react-router-dom'

const defaultProject = {
  cloudProjectId: 'remote-123',
  path: '/projects/example',
  libraryType: CLOUD_PROJECT_LIBRARY_TYPE,
} as Project

const localProject = {
  path: '/projects/example',
  libraryType: DIRECTORY_PROJECT_LIBRARY_TYPE,
} as Project

const homeProject = {
  localProjectPath: localProject.path,
  name: 'example',
  title: 'Old Example',
} as HomeProjectEntry

const cloudLibraryTarget = {
  library: {
    id: 'personal-cloud',
    type: CLOUD_PROJECT_LIBRARY_TYPE,
  },
} as HomeProjectMoveToLibraryTarget

const publishSubmission = {
  title: 'Example',
  description: 'Example project',
  categoryIds: ['robotics'],
}

const fileOperations = {}

function createApp({
  project = defaultProject,
  hasCloudSyncFeature = false,
  homeProjectActions,
  startProjectSync = vi.fn().mockResolvedValue(undefined),
  syncNow = vi.fn().mockResolvedValue({ remoteProjectId: 'remote-synced' }),
  writeToFile = vi.fn().mockResolvedValue(undefined),
  closeProject = vi.fn(),
  settingsSend = vi.fn(),
}: {
  project?: Project
  hasCloudSyncFeature?: boolean
  homeProjectActions?: HomeProjectActionsService
  startProjectSync?: ReturnType<typeof vi.fn>
  syncNow?: ReturnType<typeof vi.fn>
  writeToFile?: ReturnType<typeof vi.fn>
  closeProject?: ReturnType<typeof vi.fn>
  settingsSend?: ReturnType<typeof vi.fn>
} = {}) {
  return {
    fileOperations,
    projectSignal: {
      value: {
        projectIORefSignal: {
          value: project,
        },
      },
    },
    userFeatures: {
      useHas: () => hasCloudSyncFeature,
    },
    auth: {
      useAuthState: () => ({ matches: () => false }),
      useToken: () => 'token-123',
      useUser: () => ({ username: 'zoonaut' }),
    },
    singletons: {
      kclManager: {
        astSignal: { value: { body: [] } },
        isAstBodyEmpty: () => false,
        hasErrors: () => false,
        wasmInstancePromise: Promise.resolve({}),
        path: '/projects/example/main.kcl',
        code: '',
        writeToFile,
      },
    },
    closeProject,
    settings: {
      actor: {
        send: settingsSend,
      },
    },
    registry: {
      optional: (service: unknown) => {
        if (service === homeProjectActionsService) {
          return homeProjectActions
        }
        if (service === cloudSyncService) {
          return { startProjectSync, syncNow }
        }
        return undefined
      },
      get: (valueSpec: unknown) =>
        valueSpec === homeProjectEntriesValueSpec ? [homeProject] : [],
    },
  } as unknown as App
}

function renderPublishButton(app = createApp()) {
  return render(
    <MemoryRouter>
      <PublishButton app={app} />
    </MemoryRouter>
  )
}

async function openPublishDialog(app: App) {
  renderPublishButton(app)
  fireEvent.click(screen.getByTestId('publish-button'))
  await waitFor(() => expect(mockState.publishDialogProps).not.toBeNull())

  if (!mockState.publishDialogProps) {
    expect.fail('Publish dialog props were not captured.')
  }
  return mockState.publishDialogProps
}

describe('PublishButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.useProjectStatus.mockReturnValue(null)
    mockState.publishCurrentProject.mockResolvedValue({
      remoteProjectId: 'remote-published',
    })
    mockState.getCurrentProjectPublicationDetails.mockResolvedValue(null)
    mockState.publishDialogProps = null
  })

  test.each([
    ['pending_review', 'Pending Review', 'eyeOpen'],
    ['published', 'Published', 'checkmark'],
    ['rejected', 'Rejected', 'close'],
  ] as const)(
    'replaces Publish with the neutral %s status',
    (publicationStatus, label, icon) => {
      mockState.useProjectStatus.mockReturnValue({ publicationStatus })

      renderPublishButton()

      const publishButton = screen.getByTestId('publish-button')
      expect(publishButton).toHaveAccessibleName(label)
      expect(screen.getByTestId('publish-button-icon')).toHaveAttribute(
        'data-icon',
        icon
      )
      expect(publishButton).not.toHaveClass('bg-warn-10/60')
      expect(mockState.useProjectStatus).toHaveBeenCalledWith(
        'remote-123',
        'token-123'
      )
    }
  )

  test('highlights changes requested without putting feedback in the button', () => {
    mockState.useProjectStatus.mockReturnValue({
      publicationStatus: 'changes_requested',
      feedback: 'Add another view.',
    })

    renderPublishButton()

    const publishButton = screen.getByTestId('publish-button')
    expect(publishButton).toHaveAccessibleName('Changes requested')
    expect(publishButton).toHaveClass('bg-warn-10/60')
    expect(publishButton).toHaveClass('border-warn-80')
    expect(screen.getByTestId('publish-button-icon')).toHaveAttribute(
      'data-icon',
      'triangleExclamation'
    )
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  test('uses the default Publish action for non-publication statuses', () => {
    mockState.useProjectStatus.mockReturnValue({ publicationStatus: 'draft' })

    renderPublishButton()

    const publishButton = screen.getByTestId('publish-button')
    expect(publishButton).toHaveAccessibleName('Publish')
    expect(screen.getByTestId('publish-button-icon')).toHaveAttribute(
      'data-icon',
      'share'
    )
  })

  test.each([
    ['enabled', true, true],
    ['disabled', false, false],
  ] as const)(
    'moves after publishing when cloud sync is %s',
    async (_label, hasCloudSyncFeature, shouldMove) => {
      const moveToLibrary = vi.fn().mockResolvedValue({
        defaultFile: '/cloud/example/main.kcl',
        localProjectPath: '/cloud/example',
      })
      const rename = vi.fn().mockResolvedValue(undefined)
      const startProjectSync = vi.fn().mockResolvedValue(undefined)
      const syncNow = vi
        .fn()
        .mockResolvedValue({ remoteProjectId: 'remote-synced' })
      const writeToFile = vi.fn().mockResolvedValue(undefined)
      const closeProject = vi.fn()
      const settingsSend = vi.fn()
      const homeProjectActions = {
        canRename: vi.fn().mockReturnValue(true),
        rename,
        getMoveToLibraryTargets: vi.fn().mockReturnValue([cloudLibraryTarget]),
        moveToLibrary,
      } as unknown as HomeProjectActionsService
      const app = createApp({
        project: localProject,
        hasCloudSyncFeature,
        homeProjectActions,
        startProjectSync,
        syncNow,
        writeToFile,
        closeProject,
        settingsSend,
      })
      const dialogProps = await openPublishDialog(app)
      expect(dialogProps.willMoveProjectToCloud).toBe(shouldMove)

      await act(async () => {
        await dialogProps.onSubmit(publishSubmission)
      })

      expect(mockState.publishCurrentProject).toHaveBeenCalledOnce()
      expect(writeToFile).toHaveBeenCalledWith('')
      expect(writeToFile).toHaveBeenCalledBefore(
        mockState.publishCurrentProject
      )
      expect(rename).toHaveBeenCalledTimes(shouldMove ? 0 : 1)
      expect(startProjectSync).not.toHaveBeenCalled()
      expect(syncNow).toHaveBeenCalledTimes(shouldMove ? 1 : 0)
      expect(moveToLibrary).toHaveBeenCalledTimes(shouldMove ? 1 : 0)
      if (shouldMove) {
        expect(mockState.writeProjectTitleToProjectToml).toHaveBeenCalledWith(
          fileOperations,
          localProject.path,
          'Example'
        )
        expect(syncNow).toHaveBeenCalledWith('/cloud/example')
        expect(syncNow).toHaveBeenCalledBefore(mockState.publishCurrentProject)
        expect(mockState.publishCurrentProject).toHaveBeenCalledWith(
          expect.objectContaining({ remoteProjectId: 'remote-synced' })
        )
        expect(moveToLibrary).toHaveBeenCalledWith(
          homeProject,
          'personal-cloud'
        )
        expect(moveToLibrary).toHaveBeenCalledBefore(syncNow)
        expect(closeProject).toHaveBeenCalledOnce()
        expect(settingsSend).toHaveBeenCalledWith({
          type: 'clear.project',
        })
        expect(closeProject).toHaveBeenCalledBefore(moveToLibrary)
      } else {
        expect(rename).toHaveBeenCalledWith(homeProject, 'Example', {
          notify: false,
        })
        expect(rename).toHaveBeenCalledBefore(mockState.publishCurrentProject)
        expect(mockState.publishCurrentProject).toHaveBeenCalledWith(
          expect.objectContaining({ remoteProjectId: undefined })
        )
      }
    }
  )

  test('does not publish when cloud sync fails after moving the project', async () => {
    const homeProjectActions = {
      canRename: vi.fn().mockReturnValue(true),
      rename: vi.fn().mockResolvedValue(undefined),
      getMoveToLibraryTargets: vi.fn().mockReturnValue([cloudLibraryTarget]),
      moveToLibrary: vi.fn().mockResolvedValue({
        defaultFile: '/cloud/example/main.kcl',
        localProjectPath: '/cloud/example',
      }),
    } as unknown as HomeProjectActionsService
    const syncNow = vi.fn().mockRejectedValue(new Error('sync failed'))
    const app = createApp({
      project: localProject,
      hasCloudSyncFeature: true,
      homeProjectActions,
      syncNow,
    })
    const dialogProps = await openPublishDialog(app)

    await act(async () => {
      await expect(dialogProps.onSubmit(publishSubmission)).resolves.toBe(false)
    })

    expect(syncNow).toHaveBeenCalledWith('/cloud/example')
    expect(mockState.publishCurrentProject).not.toHaveBeenCalled()
    expect(homeProjectActions.moveToLibrary).toHaveBeenCalledWith(
      homeProject,
      'personal-cloud'
    )
  })
})
