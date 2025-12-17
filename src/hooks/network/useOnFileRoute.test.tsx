import { renderHook } from '@testing-library/react'
import { useOnFileRoute } from '@src/hooks/network/useOnFileRoute'
import type { FileEntry } from '@src/lib/project'
import { ConnectionManager } from '@src/network/connectionManager'
import { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { KclManager } from '@src/lang/KclManager'
import RustContext from '@src/lib/rustContext'
import { resetCameraPosition } from '@src/lib/resetCameraPosition'
import { Connection } from '@src/network/connection'
import { expect, vi, describe, test } from 'vitest'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { createActor } from 'xstate'
import { settingsMachine } from '@src/machines/settingsMachine'
import { createSettings } from '@src/lib/settings/initialSettings'
import { commandBarMachine } from '@src/machines/commandBarMachine'

const tick = () => {
  return new Promise((resolve, reject) => {
    setTimeout(resolve, 1)
  })
}

describe('useOnFileRoute', () => {
  describe('after mount', () => {
    test('should call unmount', async () => {
      const file: FileEntry = {
        path: '/application/project-001/main.kcl',
        name: 'main.kcl',
        children: null,
      }
      const { engineCommandManager, sceneInfra, kclManager } =
        await buildTheWorldAndNoEngineConnection(true)
      const { unmount } = renderHook(() => {
        useOnFileRoute({
          file,
          isStreamAcceptingInput: false,
          resetCameraPosition,
          systemDeps: {
            engineCommandManager,
            kclManager,
            sceneInfra,
          },
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
      const initWasmMock = Promise.resolve({} as ModuleType)
      const commandBarActor = createActor(commandBarMachine, {
        input: { commands: [], wasmInstancePromise: initWasmMock },
      }).start()
      const settingsActor = createActor(settingsMachine, {
        input: { commandBarActor, ...createSettings() },
      })
      const rustContext = new RustContext(
        engineCommandManager,
        initWasmMock,
        settingsActor
      )
      const sceneInfra = new SceneInfra(engineCommandManager)
      const kclManager = new KclManager(engineCommandManager, initWasmMock, {
        rustContext,
        sceneInfra,
      })
      const callback = vi.fn(async () => {})
      const { unmount } = renderHook(() => {
        useOnFileRoute({
          file,
          isStreamAcceptingInput: true,
          resetCameraPosition: callback,
          systemDeps: {
            engineCommandManager,
            kclManager,
            sceneInfra,
          },
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
      const initWasmMock = Promise.resolve({} as ModuleType)
      const commandBarActor = createActor(commandBarMachine, {
        input: { commands: [], wasmInstancePromise: initWasmMock },
      }).start()
      const settingsActor = createActor(settingsMachine, {
        input: { commandBarActor, ...createSettings() },
      })
      const rustContext = new RustContext(
        engineCommandManager,
        initWasmMock,
        settingsActor
      )
      const sceneInfra = new SceneInfra(engineCommandManager)
      const kclManager = new KclManager(engineCommandManager, initWasmMock, {
        rustContext,
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
            resetCameraPosition: callback,
            systemDeps: {
              engineCommandManager,
              kclManager,
              sceneInfra,
            },
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
      const initWasmMock = Promise.resolve({} as ModuleType)
      const commandBarActor = createActor(commandBarMachine, {
        input: { commands: [], wasmInstancePromise: initWasmMock },
      }).start()
      const settingsActor = createActor(settingsMachine, {
        input: { commandBarActor, ...createSettings() },
      })
      const rustContext = new RustContext(
        engineCommandManager,
        initWasmMock,
        settingsActor
      )
      const sceneInfra = new SceneInfra(engineCommandManager)
      const kclManager = new KclManager(engineCommandManager, initWasmMock, {
        rustContext,
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
            resetCameraPosition: callback,
            systemDeps: {
              engineCommandManager,
              kclManager,
              sceneInfra,
            },
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
      const initWasmMock = Promise.resolve({} as ModuleType)
      const commandBarActor = createActor(commandBarMachine, {
        input: { commands: [], wasmInstancePromise: initWasmMock },
      }).start()
      const settingsActor = createActor(settingsMachine, {
        input: { commandBarActor, ...createSettings() },
      })
      const rustContext = new RustContext(
        engineCommandManager,
        initWasmMock,
        settingsActor
      )
      const sceneInfra = new SceneInfra(engineCommandManager)
      const kclManager = new KclManager(engineCommandManager, initWasmMock, {
        rustContext,
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
            resetCameraPosition: callback,
            systemDeps: {
              engineCommandManager,
              kclManager,
              sceneInfra,
            },
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
