import { renderHook, waitFor } from '@testing-library/react'
import { useOnFileRoute } from '@src/hooks/network/useOnFileRoute'
import { vi } from 'vitest'
import type { FileEntry } from '@src/lib/project'
import type { ConnectionManager } from '@src/network/connectionManager'
import type { KclManager } from '@src/lang/KclSingleton'
import type { resetCameraPosition } from '@src/lib/resetCameraPosition'

describe('useOnFileRoute test', () => {
  test('should call nothing by default', () => {
    const f1: FileEntry = {
      path: '/application-directory/project/main.kcl',
      name: 'main.kcl',
      children: null,
    }
    const mockedEngineCommandManager = {
      started: false,
      connection: null,
    } as unknown as ConnectionManager

    const mockedKCLManager = {
      executeCode: vi.fn(() => Promise.resolve()),
    } as unknown as KclManager

    const mockedResetCameraPosition = vi.fn(() =>
      Promise.resolve()
    ) as typeof resetCameraPosition
    const { unmount } = renderHook(() => {
      useOnFileRoute({
        file: f1,
        isStreamAcceptingInput: false,
        engineCommandManager: mockedEngineCommandManager,
        kclManager: mockedKCLManager,
        resetCameraPosition: mockedResetCameraPosition,
      })
    })
    expect(mockedKCLManager.executeCode).toHaveBeenCalledTimes(0)
    expect(mockedResetCameraPosition).toHaveBeenCalledTimes(0)
    unmount()
    expect(mockedKCLManager.executeCode).toHaveBeenCalledTimes(0)
    expect(mockedResetCameraPosition).toHaveBeenCalledTimes(0)
  })
  test('should not execute if ready and initialized, this only should execute on N+1 runs', () => {
    // The hook is designed to never run on initialiation even if everything is ready.
    // When the application boots another part of the system controls "should I run on initialization"
    const f1: FileEntry = {
      path: '/application-directory/project/main.kcl',
      name: 'main.kcl',
      children: null,
    }
    const mockedEngineCommandManager = {
      started: true,
      connection: 42,
    } as unknown as ConnectionManager

    const mockedKCLManager = {
      executeCode: vi.fn(() => Promise.resolve()),
    } as unknown as KclManager

    const mockedResetCameraPosition = vi.fn(() =>
      Promise.resolve()
    ) as typeof resetCameraPosition
    const { unmount } = renderHook(() => {
      useOnFileRoute({
        file: f1,
        isStreamAcceptingInput: true,
        engineCommandManager: mockedEngineCommandManager,
        kclManager: mockedKCLManager,
        resetCameraPosition: mockedResetCameraPosition,
      })
    })
    expect(mockedKCLManager.executeCode).toHaveBeenCalledTimes(0)
    expect(mockedResetCameraPosition).toHaveBeenCalledTimes(0)
    unmount()
    expect(mockedKCLManager.executeCode).toHaveBeenCalledTimes(0)
    expect(mockedResetCameraPosition).toHaveBeenCalledTimes(0)
  })
  test('should execute code since the file changed twice', async () => {
    const f1: FileEntry = {
      path: '/application-directory/project/main.kcl',
      name: 'main.kcl',
      children: null,
    }
    const f2: FileEntry = {
      path: '/application-directory/project/dog.kcl',
      name: 'main.kcl',
      children: null,
    }
    const mockedEngineCommandManager = {
      started: true,
      connection: 42,
    } as unknown as ConnectionManager

    const mockedKCLManager = {
      executeCode: vi.fn(() => Promise.resolve()),
    } as unknown as KclManager

    const mockedResetCameraPosition = vi.fn(() =>
      Promise.resolve()
    ) as typeof resetCameraPosition
    const { rerender } = renderHook(useOnFileRoute, {
      initialProps: {
        file: f1,
        isStreamAcceptingInput: true,
        engineCommandManager: mockedEngineCommandManager,
        kclManager: mockedKCLManager,
        resetCameraPosition: mockedResetCameraPosition,
      },
    })

    // Check nothing is executed
    expect(mockedKCLManager.executeCode).toHaveBeenCalledTimes(0)
    expect(mockedResetCameraPosition).toHaveBeenCalledTimes(0)

    // Swap your file
    rerender({
      file: f2,
      isStreamAcceptingInput: true,
      engineCommandManager: mockedEngineCommandManager,
      kclManager: mockedKCLManager,
      resetCameraPosition: mockedResetCameraPosition,
    })

    // Gotcha: using a waitFor means you are firing an async call within a useEffect which cannot be awaited
    // in sync time within a unit test. You are watching state that should be done at some point in the future.
    await waitFor(() => {
      expect(mockedKCLManager.executeCode).toHaveBeenCalledTimes(1)
      expect(mockedResetCameraPosition).toHaveBeenCalledTimes(1)
    })
  })
})
