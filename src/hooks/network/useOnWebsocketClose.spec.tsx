import { renderHook } from '@testing-library/react'
import { useOnWebsocketClose } from '@src/hooks/network/useOnWebsocketClose'
import { expect, vi, describe, test } from 'vitest'
import { EngineCommandManagerEvents } from '@src/network/utils'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'

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
        new Event(EngineCommandManagerEvents.WebsocketClosed)
      )
      unmount()
      expect(callback).toHaveBeenCalledTimes(1)
    })
    test('should call infinite detection loop callback on close event', async () => {
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
      const infiniteEvent = new CustomEvent(
        EngineCommandManagerEvents.WebsocketClosed,
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
    })
  })
})
