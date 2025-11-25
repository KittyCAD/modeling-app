import { renderHook } from '@testing-library/react'
import { useOnFileRoute } from '@src/hooks/network/useOnFileRoute'
import type { FileEntry } from '@src/lib/project'
import { ConnectionManager } from '@src/network/connectionManager'
import { SceneInfra } from '@src/clientSideScene/sceneInfra'
import EditorManager from '@src/editor/manager'
import { KclManager } from '@src/lang/KclManager'
import RustContext from '@src/lib/rustContext'
import { resetCameraPosition } from '@src/lib/resetCameraPosition'
import { Connection } from '@src/network/connection'
import { vi } from 'vitest'

const tick = () => {
  return new Promise((resolve, reject) => {
    setTimeout(resolve, 1)
  })
}

describe('useOnFileRoute', () => {
  describe('after mount', () => {
    test('should call unmount', () => {
      const file: FileEntry = {
        path: '/application/project-001/main.kcl',
        name: 'main.kcl',
        children: null,
      }
      const engineCommandManager = new ConnectionManager()
      const rustContext = new RustContext(engineCommandManager)
      const sceneInfra = new SceneInfra(engineCommandManager)
      const editorManager = new EditorManager(engineCommandManager)
      const kclManager = new KclManager(engineCommandManager, {
        rustContext,
        editorManager,
        sceneInfra,
      })
      const { unmount } = renderHook(() => {
        useOnFileRoute({
          file,
          isStreamAcceptingInput: false,
          engineCommandManager,
          kclManager,
          resetCameraPosition,
        })
      })
      unmount()
    })
    test('should not call execute code and reset camera position for the first time', () => {
      const file: FileEntry = {
        path: '/application/project-001/main.kcl',
        name: 'main.kcl',
        children: null,
      }
      const engineCommandManager = new ConnectionManager()
      engineCommandManager.started = true
      engineCommandManager.connection = new Connection({
        url: 'abc',
        token: 'abc',
        handleOnDataChannelMessage: () => {},
        tearDownManager: () => {},
        rejectPendingCommand: () => {},
        callbackOnUnitTestingConnection: () => {},
        handleMessage: () => {},
      })
      const rustContext = new RustContext(engineCommandManager)
      const sceneInfra = new SceneInfra(engineCommandManager)
      const editorManager = new EditorManager(engineCommandManager)
      const kclManager = new KclManager(engineCommandManager, {
        rustContext,
        editorManager,
        sceneInfra,
      })
      const callback = vi.fn(async () => {})
      const { unmount } = renderHook(() => {
        useOnFileRoute({
          file,
          isStreamAcceptingInput: true,
          engineCommandManager,
          kclManager,
          resetCameraPosition: callback,
        })
      })
      unmount()
      expect(callback).toHaveBeenCalledTimes(0)
    })
    test('should call execute code and reset camera position because the file changed', async () => {
      const file: FileEntry = {
        path: '/application/project-001/main.kcl',
        name: 'main.kcl',
        children: null,
      }
      const fileToLoad: FileEntry = {
        path: '/application/project-001/main-1.kcl',
        name: 'main-1.kcl',
        children: null,
      }
      const engineCommandManager = new ConnectionManager()
      engineCommandManager.started = true
      engineCommandManager.connection = new Connection({
        url: 'abc',
        token: 'abc',
        handleOnDataChannelMessage: () => {},
        tearDownManager: () => {},
        rejectPendingCommand: () => {},
        callbackOnUnitTestingConnection: () => {},
        handleMessage: () => {},
      })
      const rustContext = new RustContext(engineCommandManager)
      const sceneInfra = new SceneInfra(engineCommandManager)
      const editorManager = new EditorManager(engineCommandManager)
      const kclManager = new KclManager(engineCommandManager, {
        rustContext,
        editorManager,
        sceneInfra,
      })
      const spy = vi.spyOn(kclManager, 'executeCode')
      spy.mockImplementationOnce(() => {
        return new Promise((resolve, reject) => {
          resolve()
        })
      })
      const callback = vi.fn(async () => {})
      const { unmount, rerender } = renderHook(
        ({ file }) => {
          useOnFileRoute({
            file,
            isStreamAcceptingInput: true,
            engineCommandManager,
            kclManager,
            resetCameraPosition: callback,
          })
        },
        { initialProps: { file } }
      )
      rerender({ file: fileToLoad })
      await tick()
      unmount()
      expect(callback).toHaveBeenCalledTimes(1)
      expect(kclManager.executeCode).toHaveBeenCalledTimes(1)
    })
    test('should not call execute code if you are switching to the same file twice in a row', async () => {
      const file: FileEntry = {
        path: '/application/project-001/main.kcl',
        name: 'main.kcl',
        children: null,
      }
      const fileToLoad: FileEntry = {
        path: '/application/project-001/main-1.kcl',
        name: 'main-1.kcl',
        children: null,
      }
      const engineCommandManager = new ConnectionManager()
      engineCommandManager.started = true
      engineCommandManager.connection = new Connection({
        url: 'abc',
        token: 'abc',
        handleOnDataChannelMessage: () => {},
        tearDownManager: () => {},
        rejectPendingCommand: () => {},
        callbackOnUnitTestingConnection: () => {},
        handleMessage: () => {},
      })
      const rustContext = new RustContext(engineCommandManager)
      const sceneInfra = new SceneInfra(engineCommandManager)
      const editorManager = new EditorManager(engineCommandManager)
      const kclManager = new KclManager(engineCommandManager, {
        rustContext,
        editorManager,
        sceneInfra,
      })
      const spy = vi.spyOn(kclManager, 'executeCode')
      spy.mockImplementationOnce(() => {
        return new Promise((resolve, reject) => {
          resolve()
        })
      })
      const callback = vi.fn(async () => {})
      const { unmount, rerender } = renderHook(
        ({ file }) => {
          useOnFileRoute({
            file,
            isStreamAcceptingInput: true,
            engineCommandManager,
            kclManager,
            resetCameraPosition: callback,
          })
        },
        { initialProps: { file } }
      )
      rerender({ file: fileToLoad })
      await tick()
      rerender({ file: fileToLoad })
      await tick()
      unmount()
      expect(callback).toHaveBeenCalledTimes(1)
      expect(kclManager.executeCode).toHaveBeenCalledTimes(1)
    })
    test('should not call execute code if stream is not accepting input', async () => {
      const file: FileEntry = {
        path: '/application/project-001/main.kcl',
        name: 'main.kcl',
        children: null,
      }
      const fileToLoad: FileEntry = {
        path: '/application/project-001/main-1.kcl',
        name: 'main-1.kcl',
        children: null,
      }
      const engineCommandManager = new ConnectionManager()
      engineCommandManager.started = true
      engineCommandManager.connection = new Connection({
        url: 'abc',
        token: 'abc',
        handleOnDataChannelMessage: () => {},
        tearDownManager: () => {},
        rejectPendingCommand: () => {},
        callbackOnUnitTestingConnection: () => {},
        handleMessage: () => {},
      })
      const rustContext = new RustContext(engineCommandManager)
      const sceneInfra = new SceneInfra(engineCommandManager)
      const editorManager = new EditorManager(engineCommandManager)
      const kclManager = new KclManager(engineCommandManager, {
        rustContext,
        editorManager,
        sceneInfra,
      })
      const spy = vi.spyOn(kclManager, 'executeCode')
      spy.mockImplementationOnce(() => {
        return new Promise((resolve, reject) => {
          resolve()
        })
      })
      const callback = vi.fn(async () => {})
      const { unmount, rerender } = renderHook(
        ({ file }) => {
          useOnFileRoute({
            file,
            isStreamAcceptingInput: false,
            engineCommandManager,
            kclManager,
            resetCameraPosition: callback,
          })
        },
        { initialProps: { file } }
      )
      rerender({ file: fileToLoad })
      await tick()
      unmount()
      expect(callback).toHaveBeenCalledTimes(0)
      expect(kclManager.executeCode).toHaveBeenCalledTimes(0)
    })
  })
})
