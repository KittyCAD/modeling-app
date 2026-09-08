import { render } from '@testing-library/react'
import type * as ReactRouterDom from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fileSystemWatcher: vi.fn(),
  lspFileClose: vi.fn(),
  lspFileOpen: vi.fn(),
  navigate: vi.fn(),
  rejectAllModelingCommands: vi.fn(),
  settingsSend: vi.fn(),
  systemIOSend: vi.fn(),
}))

vi.mock('@src/lib/wasm_lib_wrapper', () => ({}))

vi.mock('@src/hooks/useFileSystemWatcher', () => ({
  useFileSystemWatcher: mocks.fileSystemWatcher,
}))

vi.mock('@src/lib/boot', () => ({
  useApp: () => ({
    registry: {
      get: () => ({
        onFileClose: mocks.lspFileClose,
        onFileOpen: mocks.lspFileOpen,
      }),
    },
    settings: {
      useSettings: () => ({
        app: {
          libraries: { current: {} },
          onboardingStatus: { current: 'dismissed' },
        },
        projects: { defaultProjectName: { current: 'untitled' } },
      }),
      send: mocks.settingsSend,
    },
    systemIOActor: {
      getSnapshot: () => ({
        context: { lastProjectDeleteRequest: { project: '' } },
      }),
      send: mocks.systemIOSend,
    },
  }),
  useSingletons: () => ({
    kclManager: {
      engineCommandManager: {
        rejectAllModelingCommands: mocks.rejectAllModelingCommands,
      },
      isExecuting: true,
      switchedFiles: false,
    },
  }),
}))

vi.mock('@src/lib/projectLibraries', () => ({
  getDefaultDirectoryProjectLibraryPath: () => '/projects',
}))

vi.mock('@src/lang/lsp/registry/contract', () => ({
  lspService: {},
}))

vi.mock('@src/machines/systemIO/hooks', () => ({
  useHasListedProjects: () => false,
  useLastOperation: () => 'idle',
  useProjectDirectoryPath: () => '/projects',
  useRequestedFileName: () => ({
    file: 'blank.kcl',
    project: 'tutorial-project',
    subRoute: '/onboarding/desktop/scene',
  }),
  useRequestedProjectName: () => ({ name: '' }),
}))

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactRouterDom>()),
  useLocation: () => ({
    pathname: '/file/tutorial-project%2Fmain.kcl/onboarding/desktop/conclusion',
  }),
  useNavigate: () => mocks.navigate,
  useNavigation: () => ({ location: { pathname: '/home' } }),
}))

import { SystemIOMachineLogicListener } from '@src/components/SystemIOMachineLogicListener'

beforeEach(() => {
  vi.clearAllMocks()
})

it('ignores late onboarding navigation while Home is loading', () => {
  render(<SystemIOMachineLogicListener />)

  expect(mocks.navigate).not.toHaveBeenCalled()
  expect(mocks.lspFileOpen).not.toHaveBeenCalled()
})
