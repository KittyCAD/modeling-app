import { useOnWebsocketClose } from '@src/hooks/network/useOnWebsocketClose'
import {
  EngineConnectionErrorKind,
  EngineConnectionManagerEvents,
} from '@src/lib/engineConnection/utils'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { renderHook } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

describe('useOnWebsocketClose', () => {
  describe('on mounted', () => {
    test('should not run any callbacks', async () => {
      const callback = vi.fn(() => 1)
      const infiniteLoopCallback = vi.fn(() => 1)
      const { engineCommandManager } =
        await buildTheWorldAndNoEngineConnection(true)
      const { unmount } = renderHook(() =>
        useOnWebsocketClose({
          callback,
          infiniteDetectionLoopCallback: infiniteLoopCallback,
          engineCommandManager,
        })
      )
      unmount()
      expect(callback).toHaveBeenCalledTimes(0)
      expect(infiniteLoopCallback).toHaveBeenCalledTimes(0)
    })
    test('should attach and remove event listeners', async () => {
      const callback = vi.fn(() => 1)
      const infiniteLoopCallback = vi.fn(() => 1)
      const { engineCommandManager } =
        await buildTheWorldAndNoEngineConnection(true)
      const spyAdd = vi.spyOn(engineCommandManager, 'addEventListener')
      const spyRemove = vi.spyOn(engineCommandManager, 'removeEventListener')
      const { unmount } = renderHook(() =>
        useOnWebsocketClose({
          callback,
          infiniteDetectionLoopCallback: infiniteLoopCallback,
          engineCommandManager,
        })
      )
      unmount()
      expect(spyAdd).toHaveBeenCalledTimes(1)
      expect(spyRemove).toHaveBeenCalledTimes(1)
    })
    test('should call callback on close event', async () => {
      const callback = vi.fn(() => 1)
      const infiniteLoopCallback = vi.fn(() => 1)
      const { engineCommandManager } =
        await buildTheWorldAndNoEngineConnection(true)
      const { unmount } = renderHook(() =>
        useOnWebsocketClose({
          callback,
          infiniteDetectionLoopCallback: infiniteLoopCallback,
          engineCommandManager,
        })
      )
      engineCommandManager.dispatchEvent(
        new Event(EngineConnectionManagerEvents.WebsocketClosed)
      )
      unmount()
      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith(undefined, false)
    })
    test.each(['1000', '1006'])(
      'recovers from a requested reconnect ending with %s',
      async (code) => {
        const callback = vi.fn()
        const infiniteLoopCallback = vi.fn()
        const { engineCommandManager } =
          await buildTheWorldAndNoEngineConnection(true)
        const { unmount } = renderHook(() =>
          useOnWebsocketClose({
            callback,
            infiniteDetectionLoopCallback: infiniteLoopCallback,
            engineCommandManager,
          })
        )
        engineCommandManager.tearDown({
          websocketClosed: true,
          code,
          reconnectRequested: true,
        })
        expect(callback).toHaveBeenCalledExactlyOnceWith(code, true)
        expect(infiniteLoopCallback).not.toHaveBeenCalled()
        unmount()
      }
    )

    test('preserves normal closure recovery when no reconnect was requested', async () => {
      const callback = vi.fn()
      const infiniteLoopCallback = vi.fn()
      const { engineCommandManager } =
        await buildTheWorldAndNoEngineConnection(true)
      const { unmount } = renderHook(() =>
        useOnWebsocketClose({
          callback,
          infiniteDetectionLoopCallback: infiniteLoopCallback,
          engineCommandManager,
        })
      )
      engineCommandManager.tearDown({ websocketClosed: true, code: '1000' })
      expect(callback).toHaveBeenCalledExactlyOnceWith('1000', false)
      expect(infiniteLoopCallback).not.toHaveBeenCalled()
      unmount()
    })

    test('requires manual recovery after three abnormal closes', async () => {
      const callback = vi.fn(() => 1)
      const infiniteLoopCallback = vi.fn(() => 1)
      const { engineCommandManager } =
        await buildTheWorldAndNoEngineConnection(true)
      const { result, rerender, unmount } = renderHook(() =>
        useOnWebsocketClose({
          callback,
          infiniteDetectionLoopCallback: infiniteLoopCallback,
          engineCommandManager,
        })
      )
      const infiniteEvent = new CustomEvent(
        EngineConnectionManagerEvents.WebsocketClosed,
        {
          detail: {
            code: '1006',
          },
        }
      )
      for (let attempt = 1; attempt <= 3; attempt++) {
        engineCommandManager.dispatchEvent(infiniteEvent)
        expect(callback).toHaveBeenCalledTimes(attempt)
        expect(infiniteLoopCallback).not.toHaveBeenCalled()
        rerender()
      }
      engineCommandManager.dispatchEvent(infiniteEvent)
      expect(callback).toHaveBeenCalledTimes(3)
      expect(infiniteLoopCallback).toHaveBeenCalledTimes(1)
      expect(infiniteLoopCallback).toHaveBeenCalledWith('1006')
      result.current.current = 0
      engineCommandManager.dispatchEvent(infiniteEvent)
      expect(callback).toHaveBeenCalledTimes(4)
      expect(infiniteLoopCallback).toHaveBeenCalledTimes(1)
      unmount()
    })
    test.each([false, true])(
      'routes terminal errors without reconnecting (reconnectRequested=%s)',
      async (reconnectRequested) => {
        const callback = vi.fn(() => 1)
        const infiniteLoopCallback = vi.fn(() => 1)
        const terminalErrorCallback = vi.fn(() => 1)
        const { engineCommandManager } =
          await buildTheWorldAndNoEngineConnection(true)
        const { unmount } = renderHook(() =>
          useOnWebsocketClose({
            callback,
            infiniteDetectionLoopCallback: infiniteLoopCallback,
            terminalErrorCallback,
            engineCommandManager,
          })
        )
        const connectionError = {
          kind: EngineConnectionErrorKind.BackendDisconnect,
          message: 'backend disconnected',
          terminal: true,
        }

        engineCommandManager.tearDown({
          websocketClosed: true,
          code: '1011',
          connectionError,
          reconnectRequested,
        })
        unmount()

        expect(engineCommandManager.lastConnectionError).toEqual(
          connectionError
        )
        expect(terminalErrorCallback).toHaveBeenCalledOnce()
        expect(terminalErrorCallback).toHaveBeenCalledWith(
          connectionError,
          '1011'
        )
        expect(callback).not.toHaveBeenCalled()
        expect(infiniteLoopCallback).not.toHaveBeenCalled()
      }
    )
  })
})
