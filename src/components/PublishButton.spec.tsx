import type { ProjectPublishSubmission } from '@src/lib/share'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

type PublishDialogTestProps = {
  onSubmit: (submission: ProjectPublishSubmission) => Promise<boolean>
  willMoveProjectToCloud: boolean
}

const mockState = vi.hoisted(() => ({
  useProjectStatus: vi.fn(),
  publishCurrentProject: vi.fn(),
  getCurrentProjectPublicationDetails: vi.fn(),
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

vi.mock('@src/components/PublishDialog', () => ({
  PublishDialog: (props: PublishDialogTestProps) => {
    mockState.publishDialogProps = props
    return <div data-testid="publish-dialog" />
  },
}))

import { PublishButton } from '@src/components/PublishButton'
import type { App } from '@src/lib/app'
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

function createApp({
  project = defaultProject,
  hasCloudSyncFeature = false,
  homeProjectActions,
  writeToFile = vi.fn().mockResolvedValue(undefined),
  closeProject = vi.fn(),
  settingsSend = vi.fn(),
}: {
  project?: Project
  hasCloudSyncFeature?: boolean
  homeProjectActions?: HomeProjectActionsService
  writeToFile?: ReturnType<typeof vi.fn>
  closeProject?: ReturnType<typeof vi.fn>
  settingsSend?: ReturnType<typeof vi.fn>
} = {}) {
  return {
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
      optional: (service: unknown) =>
        service === homeProjectActionsService ? homeProjectActions : undefined,
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
    mockState.publishCurrentProject.mockResolvedValue(true)
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
      })
      const writeToFile = vi.fn().mockResolvedValue(undefined)
      const closeProject = vi.fn()
      const settingsSend = vi.fn()
      const homeProjectActions = {
        getMoveToLibraryTargets: vi.fn().mockReturnValue([cloudLibraryTarget]),
        moveToLibrary,
      } as unknown as HomeProjectActionsService
      const app = createApp({
        project: localProject,
        hasCloudSyncFeature,
        homeProjectActions,
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
      expect(moveToLibrary).toHaveBeenCalledTimes(shouldMove ? 1 : 0)
      if (shouldMove) {
        expect(moveToLibrary).toHaveBeenCalledWith(
          homeProject,
          'personal-cloud'
        )
        expect(
          mockState.publishCurrentProject.mock.invocationCallOrder[0]
        ).toBeLessThan(moveToLibrary.mock.invocationCallOrder[0])
        expect(closeProject).toHaveBeenCalledOnce()
        expect(settingsSend).toHaveBeenCalledWith({
          type: 'clear.project',
        })
        expect(closeProject).toHaveBeenCalledBefore(moveToLibrary)
      }
    }
  )
})
