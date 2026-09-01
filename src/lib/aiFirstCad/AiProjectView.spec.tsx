import { AiProjectView } from '@src/lib/aiFirstCad/AiProjectView'
import { EXECUTE_AST_INTERRUPT_ERROR_STRING } from '@src/lib/constants'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type * as ReactRouterDom from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const appState = {
    isStreamAcceptingInput: false,
    isStreamReady: false,
  }
  const navigate = vi.fn()
  const locationState = { value: null as unknown }
  const mode = { value: 'ai' as 'ai' | 'manual' | 'code' }
  const setCanvasGridVisible = vi.fn()
  const executeCode = vi.fn(async () => {})
  const takeViewportScreenshot = vi.fn(() => 'data:image/png;base64,snapshot')
  const loadProjectSnapshotCache = vi.fn(async () => new Map<string, string>())
  const writeProjectSnapshotCache = vi.fn(async () => true)
  const kclManager = {
    cancelAllExecutions: vi.fn(),
    code: 'main = 1',
    engineCommandManager: { started: true },
    errors: [] as Array<{ msg: string }>,
    executeCode,
    hasErrors: vi.fn(() => false),
    hasParseErrors: vi.fn(() => false),
    isExecuting: false,
    lastSuccessfulCode: 'main = 1',
    path: '/workspace/demo/main.kcl',
    sceneInfra: {},
    switchedFiles: false,
  }
  const project = {
    executingFileEntry: {
      value: { path: '/workspace/demo/main.kcl' },
    },
    executingPath: '/workspace/demo/main.kcl',
    openEditor: vi.fn(async (path: string) => {
      kclManager.path = path
      project.executingPath = path
      project.executingFileEntry.value = { path }
      return kclManager
    }),
    projectIORefSignal: {
      value: {
        children: [],
        name: 'Demo',
        path: '/workspace/demo',
      },
    },
  }
  const app = {
    project,
    settings: { actor: {} },
  }

  return {
    app,
    appState,
    executeCode,
    kclManager,
    loadProjectSnapshotCache,
    locationState,
    mode,
    navigate,
    project,
    setCanvasGridVisible,
    takeViewportScreenshot,
    writeProjectSnapshotCache,
  }
})

vi.mock('@preact/signals-react/runtime', () => ({
  useSignals: () => {},
}))

vi.mock('@src/AppState', () => ({
  useAppState: () => mocks.appState,
}))

vi.mock('@src/components/CustomIcon', () => ({
  CustomIcon: () => null,
}))

vi.mock('@src/lib/aiFirstCad/context', () => ({
  useAiFirstCad: () => ({
    mode: mocks.mode.value,
    projectEditRevision: 0,
    setCanvasGridVisible: mocks.setCanvasGridVisible,
  }),
}))

vi.mock('@src/lib/aiFirstCad/projectFiles', () => ({
  getProjectKclFiles: () => [
    { label: 'component.kcl', path: '/workspace/demo/component.kcl' },
  ],
}))

vi.mock('@src/lib/aiFirstCad/projectSnapshotCache', () => ({
  loadProjectSnapshotCache: mocks.loadProjectSnapshotCache,
  revokeProjectSnapshotCache: vi.fn(),
  writeProjectSnapshotCache: mocks.writeProjectSnapshotCache,
}))

vi.mock('@src/lib/boot', () => ({
  useApp: () => mocks.app,
  useSingletons: () => ({ kclManager: mocks.kclManager }),
}))

vi.mock('@src/lib/resetCameraPosition', () => ({
  resetCameraPosition: vi.fn(async () => {}),
}))

vi.mock('@src/lib/screenshot', () => ({
  takeViewportScreenshot: mocks.takeViewportScreenshot,
}))

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactRouterDom>()),
  useLocation: () => ({ state: mocks.locationState.value }),
  useNavigate: () => mocks.navigate,
}))

function TestView({ active }: { active?: boolean } = {}) {
  return (
    <>
      <video id="video-stream">
        <track kind="captions" />
      </video>
      <AiProjectView active={active} />
    </>
  )
}

function makeVideoReady(frameDelay = 0) {
  const video = document.getElementById('video-stream')
  expect(video).toBeInstanceOf(HTMLVideoElement)
  if (!(video instanceof HTMLVideoElement)) {
    return
  }

  Object.defineProperties(video, {
    readyState: {
      configurable: true,
      value: 4,
    },
    videoHeight: { configurable: true, value: 720 },
    videoWidth: { configurable: true, value: 1280 },
  })
  video.requestVideoFrameCallback = vi.fn((callback) => {
    window.setTimeout(() => callback(0, {}), frameDelay)
    return 1
  })
  video.cancelVideoFrameCallback = vi.fn()
}

describe('AiProjectView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.appState.isStreamAcceptingInput = false
    mocks.appState.isStreamReady = false
    mocks.kclManager.isExecuting = false
    mocks.kclManager.lastSuccessfulCode = mocks.kclManager.code
    mocks.kclManager.errors = []
    mocks.kclManager.hasErrors.mockImplementation(
      () => mocks.kclManager.errors.length > 0
    )
    mocks.kclManager.hasParseErrors.mockReturnValue(false)
    mocks.executeCode.mockImplementation(async () => {
      mocks.kclManager.errors = []
      mocks.kclManager.lastSuccessfulCode = mocks.kclManager.code
    })
    mocks.takeViewportScreenshot.mockReturnValue(
      'data:image/png;base64,snapshot'
    )
    mocks.loadProjectSnapshotCache.mockResolvedValue(new Map())
    mocks.locationState.value = null
    mocks.mode.value = 'ai'
    mocks.writeProjectSnapshotCache.mockResolvedValue(true)
    mocks.kclManager.path = '/workspace/demo/main.kcl'
    mocks.project.executingPath = '/workspace/demo/main.kcl'
    mocks.project.executingFileEntry.value = {
      path: '/workspace/demo/main.kcl',
    }
  })

  it('renders Canvas explicitly outside AI mode', async () => {
    mocks.mode.value = 'manual'
    mocks.loadProjectSnapshotCache.mockResolvedValue(
      new Map([
        ['/workspace/demo/component.kcl', 'blob:cached-component-preview'],
      ])
    )

    render(<TestView active />)

    expect(await screen.findByRole('heading', { name: 'Canvas' })).toBeVisible()
    expect(
      screen.getByAltText('Cached 3D snapshot of component.kcl')
    ).toBeVisible()
  })

  it('shows a spinner while connecting, renders in-place, and restores the original file', async () => {
    const { rerender } = render(<TestView />)
    makeVideoReady()

    expect(
      await screen.findByRole('status', {
        name: 'Regenerating preview for component.kcl',
      })
    ).toBeVisible()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Canvas' })).toBeVisible()
    expect(mocks.executeCode).not.toHaveBeenCalled()

    mocks.appState.isStreamReady = true
    mocks.appState.isStreamAcceptingInput = true
    rerender(<TestView />)

    const snapshotImage = await screen.findByAltText(
      '3D snapshot of component.kcl'
    )
    expect(snapshotImage).toBeVisible()
    expect(snapshotImage).toHaveClass('object-cover', 'scale-[1.25]')
    const snapshotCard = screen.getByRole('button', {
      name: 'Open component.kcl',
    })
    const snapshotCaption = screen.getByText('component.kcl')
    expect(snapshotCaption.parentElement).toBe(snapshotCard)
    expect(snapshotImage.parentElement).not.toContainElement(snapshotCaption)
    await waitFor(() => {
      expect(mocks.project.openEditor).toHaveBeenNthCalledWith(
        1,
        '/workspace/demo/component.kcl',
        mocks.kclManager
      )
      expect(mocks.project.openEditor).toHaveBeenNthCalledWith(
        2,
        '/workspace/demo/main.kcl',
        mocks.kclManager
      )
    })
    expect(mocks.executeCode).toHaveBeenCalledTimes(2)
    expect(mocks.writeProjectSnapshotCache).toHaveBeenCalledWith(
      '/workspace/demo',
      '/workspace/demo/component.kcl',
      'data:image/png;base64,snapshot'
    )
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('loads the matching per-file preview before the engine is ready', async () => {
    mocks.loadProjectSnapshotCache.mockResolvedValue(
      new Map([
        ['/workspace/demo/component.kcl', 'blob:cached-component-preview'],
      ])
    )

    render(<TestView />)

    const cachedImage = await screen.findByAltText(
      'Cached 3D snapshot of component.kcl'
    )
    expect(cachedImage).toHaveAttribute('src', 'blob:cached-component-preview')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(mocks.executeCode).not.toHaveBeenCalled()
  })

  it('does not rerender a project whose per-file cache is complete', async () => {
    mocks.appState.isStreamReady = true
    mocks.appState.isStreamAcceptingInput = true
    mocks.loadProjectSnapshotCache.mockResolvedValue(
      new Map([
        ['/workspace/demo/component.kcl', 'blob:cached-component-preview'],
      ])
    )

    render(<TestView />)

    expect(
      await screen.findByAltText('Cached 3D snapshot of component.kcl')
    ).toBeVisible()
    await waitFor(() => {
      expect(mocks.loadProjectSnapshotCache).toHaveBeenCalledOnce()
    })
    expect(mocks.project.openEditor).not.toHaveBeenCalled()
    expect(mocks.executeCode).not.toHaveBeenCalled()
    expect(mocks.writeProjectSnapshotCache).not.toHaveBeenCalled()
  })

  it('keeps cached previews stable when the project reference refreshes', async () => {
    mocks.loadProjectSnapshotCache.mockResolvedValue(
      new Map([
        ['/workspace/demo/component.kcl', 'blob:cached-component-preview'],
      ])
    )

    const { rerender } = render(<TestView />)

    expect(
      await screen.findByAltText('Cached 3D snapshot of component.kcl')
    ).toBeVisible()

    mocks.project.projectIORefSignal.value = {
      ...mocks.project.projectIORefSignal.value,
    }
    rerender(<TestView />)

    await waitFor(() => {
      expect(mocks.loadProjectSnapshotCache).toHaveBeenCalledOnce()
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(
      screen.getByAltText('Cached 3D snapshot of component.kcl')
    ).toBeVisible()
  })

  it('opens a clicked Canvas file in its modeling stream', async () => {
    mocks.loadProjectSnapshotCache.mockResolvedValue(
      new Map([
        ['/workspace/demo/component.kcl', 'blob:cached-component-preview'],
      ])
    )

    render(<TestView />)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open component.kcl' })
    )

    expect(mocks.navigate).toHaveBeenCalledWith(
      '/file/%2Fworkspace%2Fdemo%2Fcomponent.kcl',
      { state: { aiFirstCadShowStream: true } }
    )
    expect(
      screen.queryByRole('button', { name: 'Open component.kcl' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Canvas' })).toBeVisible()
  })

  it('keeps the stream open after file-route navigation remounts Canvas', () => {
    mocks.locationState.value = { aiFirstCadShowStream: true }

    render(<TestView />)

    expect(screen.getByRole('button', { name: 'Canvas' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Open component.kcl' })
    ).not.toBeInTheDocument()
  })

  it('executes project captures when a switched project has not run yet', async () => {
    mocks.appState.isStreamReady = true
    mocks.appState.isStreamAcceptingInput = true
    mocks.kclManager.lastSuccessfulCode = ''

    render(<TestView />)
    makeVideoReady()

    expect(
      await screen.findByAltText('3D snapshot of component.kcl')
    ).toBeVisible()
    expect(mocks.project.openEditor).toHaveBeenCalledWith(
      '/workspace/demo/component.kcl',
      mocks.kclManager
    )
  })

  it('retries engine-interrupted captures instead of showing a file error', async () => {
    mocks.appState.isStreamReady = true
    mocks.appState.isStreamAcceptingInput = true
    mocks.kclManager.lastSuccessfulCode = ''
    let attempt = 0
    mocks.executeCode.mockImplementation(async () => {
      attempt += 1
      if (attempt === 1) {
        mocks.kclManager.errors = [{ msg: EXECUTE_AST_INTERRUPT_ERROR_STRING }]
        return
      }
      mocks.kclManager.errors = []
      mocks.kclManager.lastSuccessfulCode = mocks.kclManager.code
    })

    render(<TestView />)
    makeVideoReady()

    expect(
      await screen.findByAltText('3D snapshot of component.kcl')
    ).toBeVisible()
    expect(mocks.executeCode).toHaveBeenCalledTimes(3)
    expect(
      screen.queryByText('This file did not render successfully.')
    ).not.toBeInTheDocument()
  })

  it('shows the file error instead of borrowing the project thumbnail', async () => {
    mocks.appState.isStreamReady = true
    mocks.appState.isStreamAcceptingInput = true
    mocks.takeViewportScreenshot.mockReturnValue('')

    render(<TestView />)
    makeVideoReady()

    expect(
      await screen.findByText('The engine returned an empty snapshot.')
    ).toBeVisible()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows a per-file spinner while a live capture is pending', async () => {
    mocks.appState.isStreamReady = true
    mocks.appState.isStreamAcceptingInput = true

    render(<TestView />)
    makeVideoReady(100)

    expect(
      await screen.findByRole('status', {
        name: 'Regenerating preview for component.kcl',
      })
    ).toBeVisible()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(mocks.takeViewportScreenshot).not.toHaveBeenCalled()

    expect(
      await screen.findByAltText('3D snapshot of component.kcl')
    ).toBeVisible()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('keeps the project thumbnail isolated from Canvas previews', async () => {
    render(<TestView />)

    expect(
      await screen.findByRole('status', {
        name: 'Regenerating preview for component.kcl',
      })
    ).toBeVisible()
    expect(
      screen.queryByAltText(/Stored project preview/)
    ).not.toBeInTheDocument()
  })
})
