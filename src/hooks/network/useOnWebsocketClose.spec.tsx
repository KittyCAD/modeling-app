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
      unmount()
      expect(callback).toHaveBeenCalledTimes(0)
      expect(infiniteLoopCallback).toHaveBeenCalledTimes(0)
      expect(terminalErrorCallback).toHaveBeenCalledTimes(0)
    })
    test('should attach and remove event listeners', async () => {
      const callback = vi.fn(() => 1)
      const infiniteLoopCallback = vi.fn(() => 1)
      const terminalErrorCallback = vi.fn(() => 1)
      const { engineCommandManager } =
        await buildTheWorldAndNoEngineConnection(true)
      const spyAdd = vi.spyOn(engineCommandManager, 'addEventListener')
      const spyRemove = vi.spyOn(engineCommandManager, 'removeEventListener')
      const { unmount } = renderHook(() =>
        useOnWebsocketClose({
          callback,
          infiniteDetectionLoopCallback: infiniteLoopCallback,
          terminalErrorCallback,
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
      engineCommandManager.dispatchEvent(
        new Event(EngineConnectionManagerEvents.WebsocketClosed)
      )
      unmount()
      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith(undefined)
    })
    test('should call infinite detection loop callback on close event', async () => {
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
      const infiniteEvent = new CustomEvent(
        EngineConnectionManagerEvents.WebsocketClosed,
        {
          detail: {
            code: '1006',
          },
        }
      )
      engineCommandManager.dispatchEvent(infiniteEvent)
      unmount()
      expect(callback).toHaveBeenCalledTimes(0)
      expect(infiniteLoopCallback).toHaveBeenCalledTimes(1)
      expect(infiniteLoopCallback).toHaveBeenCalledWith('1006')
    })
    test('routes terminal errors without invoking automatic reconnect callbacks', async () => {
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

      engineCommandManager.dispatchEvent(
        new CustomEvent(EngineConnectionManagerEvents.WebsocketClosed, {
          detail: {
            code: '1011',
            connectionError,
          },
        })
      )
      unmount()

      expect(terminalErrorCallback).toHaveBeenCalledOnce()
      expect(terminalErrorCallback).toHaveBeenCalledWith(
        connectionError,
        '1011'
      )
      expect(callback).not.toHaveBeenCalled()
      expect(infiniteLoopCallback).not.toHaveBeenCalled()
    })
  })
})
