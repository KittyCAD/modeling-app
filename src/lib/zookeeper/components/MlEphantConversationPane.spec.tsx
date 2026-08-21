import fsZds, { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeAll, describe, expect, test, vi } from 'vitest'

vi.mock('@src/routes/utils', () => ({
  getAppVersion: () => 'test',
  isPlaywrightTestEnv: false,
}))

vi.mock('@src/lib/desktop', () => ({
  getDesktopAppInfo: () => null,
  isDesktop: () => false,
  openExternalBrowserIfDesktop: vi.fn(),
  DESKTOP_OS_INFO: null,
}))

vi.mock('@src/lib/boot', () => ({
  useApp: () => ({
    registry: {
      reconfigure: vi.fn(),
    },
  }),
  useSingletons: () => ({
    kclManager: {
      astSignal: { value: null },
    },
  }),
}))

import { MlEphantConversationPane } from '@src/lib/zookeeper/components/MlEphantConversationPane'
import type {
  Conversation,
  MlCopilotModeId,
  MlCopilotModeOption,
} from '@src/lib/zookeeper/mlEphantManagerMachine'
import { MlEphantManagerTransitions } from '@src/lib/zookeeper/mlEphantManagerMachine'

type MlEphantConversationPaneProps = Parameters<
  typeof MlEphantConversationPane
>[0]

const completedConversation: Conversation = {
  exchanges: [
    {
      request: {
        type: 'user',
        content: 'make a cube 10mm',
      },
      responses: [
        {
          end_of_stream: {
            whole_response: 'Done.',
          },
        },
      ],
      deltasAggregated: 'Done.',
    },
  ],
}

type FakeMlEphantSnapshot = {
  value: string
  context: {
    abruptlyClosed: boolean
    awaitingResponse: boolean
    attachmentsLoadedForCurrentPrompt: boolean
    conversation?: Conversation
    conversationId?: string
    defaultMode?: MlCopilotModeId
    modeOptions?: MlCopilotModeOption[]
  }
  matches: (state: unknown) => boolean
}

type FakeMlEphantActor = {
  getSnapshot: () => FakeMlEphantSnapshot
  subscribe: (listener?: (next: FakeMlEphantSnapshot) => void) => {
    unsubscribe: () => void
  }
  send: ReturnType<typeof vi.fn>
}

const createFakeActor = ({
  conversation = completedConversation,
  defaultMode = undefined,
  modeOptions = undefined,
  value = 'ready',
  awaitingResponse = true,
}: {
  conversation?: Conversation
  defaultMode?: MlCopilotModeId
  modeOptions?: MlCopilotModeOption[]
  value?: string
  awaitingResponse?: boolean
} = {}): FakeMlEphantActor => {
  const snapshot: FakeMlEphantSnapshot = {
    value,
    context: {
      abruptlyClosed: false,
      awaitingResponse,
      attachmentsLoadedForCurrentPrompt: true,
      conversation,
      conversationId: 'conversation-id',
      defaultMode,
      modeOptions,
    },
    matches: (state: unknown) => state === value,
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: () => ({
      unsubscribe: vi.fn(),
    }),
    send: vi.fn(),
  }
}

const renderPane = ({
  mlEphantManagerActor = createFakeActor(),
  clearChat = vi.fn(async () => undefined),
  reconnect = vi.fn(),
  theProject = undefined,
  settingsMetaId = 'project-id',
  settingsProjectDirectory = '',
  zookeeperMode = {},
  kclManager = {
    code: '',
    execState: {
      filenames: [],
    },
    artifactGraph: {},
  } as unknown as MlEphantConversationPaneProps['kclManager'],
  loaderFile = undefined,
}: {
  mlEphantManagerActor?: FakeMlEphantActor
  clearChat?: () => Promise<void>
  reconnect?: () => void
  theProject?: MlEphantConversationPaneProps['theProject']
  settingsMetaId?: string
  settingsProjectDirectory?: string
  zookeeperMode?: {
    current?: MlCopilotModeId
    project?: MlCopilotModeId
    user?: MlCopilotModeId
  }
  kclManager?: MlEphantConversationPaneProps['kclManager']
  loaderFile?: MlEphantConversationPaneProps['loaderFile']
} = {}) => {
  return render(
    <MemoryRouter>
      <MlEphantConversationPane
        mlEphantManagerActor={
          mlEphantManagerActor as unknown as MlEphantConversationPaneProps['mlEphantManagerActor']
        }
        clearChat={clearChat}
        reconnect={reconnect}
        kclManager={kclManager}
        theProject={theProject}
        contextModeling={
          {
            selectionRanges: {
              graphSelections: [],
              otherSelections: [],
            },
          } as unknown as MlEphantConversationPaneProps['contextModeling']
        }
        sendModeling={
          vi.fn() as unknown as MlEphantConversationPaneProps['sendModeling']
        }
        settings={
          {
            meta: {
              id: {
                current: settingsMetaId,
              },
            },
            app: {
              projectDirectory: {
                current: settingsProjectDirectory,
              },
              zookeeperMode: {
                current: zookeeperMode.current,
                project: zookeeperMode.project,
                user: zookeeperMode.user,
              },
            },
            modeling: {
              useSketchSolveMode: {
                current: false,
              },
            },
          } as unknown as MlEphantConversationPaneProps['settings']
        }
        loaderFile={loaderFile}
      />
    </MemoryRouter>
  )
}

beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})

describe('MlEphantConversationPane', () => {
  test('keeps the cancel button visible while the actor is still awaiting a response', () => {
    renderPane()

    expect(
      screen.getByTestId('ml-ephant-conversation-cancel-button')
    ).toBeInTheDocument()
  })

  test('queues follow-up input while the actor is still awaiting a response', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      renderPane()

      fireEvent.change(screen.getByTestId('ml-ephant-conversation-input'), {
        target: { value: 'make a cube 20mm' },
      })
      fireEvent.click(screen.getByTestId('ml-ephant-conversation-input-button'))

      expect(screen.getByText('Queued')).toBeInTheDocument()
      expect(screen.getByText('make a cube 20mm')).toBeInTheDocument()
    } finally {
      warnSpy.mockRestore()
    }
  })

  test('uses the server default mode when no project setting is set', () => {
    renderPane({
      mlEphantManagerActor: createFakeActor({
        defaultMode: 'deep',
        modeOptions: [
          {
            id: 'standard',
            label: 'Standard',
            description: 'Faster reasoning.',
            icon: 'stopwatch',
            disabled: false,
          },
          {
            id: 'deep',
            label: 'Deep',
            description: 'More thorough reasoning.',
            icon: 'brain',
            disabled: false,
          },
        ],
      }),
    })

    expect(screen.getByTestId('ml-copilot-efforts-button')).toHaveTextContent(
      'Deep'
    )
  })

  test('uses a stored project mode over the server default', () => {
    renderPane({
      zookeeperMode: { project: 'standard' },
      mlEphantManagerActor: createFakeActor({
        defaultMode: 'deep',
        modeOptions: [
          {
            id: 'standard',
            label: 'Standard',
            description: 'Faster reasoning.',
            icon: 'stopwatch',
            disabled: false,
          },
          {
            id: 'deep',
            label: 'Deep',
            description: 'More thorough reasoning.',
            icon: 'brain',
            disabled: false,
          },
        ],
      }),
    })

    expect(screen.getByTestId('ml-copilot-efforts-button')).toHaveTextContent(
      'Standard'
    )
  })

  test('sends the live editor contents for the active file when starting a prompt', async () => {
    const projectRoot = fsZds.join(
      '/tmp',
      `zookeeper-current-file-${Date.now()}`
    )
    const projectPath = fsZds.join(projectRoot, 'demo-project')
    const mainPath = fsZds.join(projectPath, 'main.kcl')
    const diskCode = 'boxHeight = 50mm\n'
    const editorCode = 'boxHeight = 500mm\n'
    const mlEphantManagerActor = createFakeActor({
      awaitingResponse: false,
    })

    await fsZds.mkdir(projectPath, { recursive: true })
    await fsZds.writeFile(mainPath, new TextEncoder().encode(diskCode))

    try {
      renderPane({
        mlEphantManagerActor,
        settingsProjectDirectory: projectRoot,
        theProject: {
          name: 'demo-project',
          path: projectPath,
          default_file: mainPath,
          children: [],
          kcl_file_count: 1,
          directory_count: 0,
          metadata: null,
          readWriteAccess: true,
        },
        loaderFile: {
          name: 'main.kcl',
          path: mainPath,
          children: null,
        },
        kclManager: {
          code: editorCode,
          path: mainPath,
          execState: {
            filenames: {
              0: {
                type: 'Local',
                value: mainPath,
                original_import_path: null,
              },
            },
          },
          artifactGraph: {},
        } as unknown as MlEphantConversationPaneProps['kclManager'],
      })

      fireEvent.change(screen.getByTestId('ml-ephant-conversation-input'), {
        target: { value: 'change the height to 5000' },
      })
      fireEvent.click(screen.getByTestId('ml-ephant-conversation-input-button'))

      await waitFor(() => {
        expect(mlEphantManagerActor.send).toHaveBeenCalledWith(
          expect.objectContaining({
            type: MlEphantManagerTransitions.MessageSend,
          })
        )
      })

      const messageSend = mlEphantManagerActor.send.mock.calls
        .map(([event]) => event)
        .find((event) => event.type === MlEphantManagerTransitions.MessageSend)
      const activeProjectFile = messageSend?.projectFiles.find(
        (file: { relPath: string }) => file.relPath === 'main.kcl'
      )

      expect(messageSend?.fileSelectedDuringPrompting.content).toBe(editorCode)
      expect(activeProjectFile?.fileContents).toBe(editorCode)
    } finally {
      await fsZds.rm(projectRoot, { recursive: true, force: true })
    }
  })

  test('delegates clear chat to the Zookeeper service', () => {
    const clearChat = vi.fn(async () => undefined)

    renderPane({ clearChat })

    fireEvent.click(screen.getByRole('button', { name: /Clear chat/ }))

    expect(clearChat).toHaveBeenCalled()
  })
})
