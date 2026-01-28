import { renderHook } from '@testing-library/react'
import { useOnWebsocketClose } from '@src/hooks/network/useOnWebsocketClose'
import { expect, vi, describe, test } from 'vitest'
import { ConnectionManager } from '@src/network/connectionManager'
import { EngineCommandManagerEvents } from '@src/network/utils'
import { useRef } from 'react'

describe('useOnWebsocketClose', () => {
  describe('on mounted', () => {
    test('should not run any callbacks', () => {
      const callback = vi.fn(() => 1)
      const infiniteLoopCallback = vi.fn(() => 1)
      const engineCommandManager = new ConnectionManager()
      const { unmount } = renderHook(() => {
        const numberOf1006Disconnects = useRef(0)

        const actual = useOnWebsocketClose({
          callback,
          infiniteDetectionLoopCallback: infiniteLoopCallback,
          engineCommandManager,
          numberOf1006Disconnects,
        })
        return { actual }
      })
      unmount()
      expect(callback).toHaveBeenCalledTimes(0)
      expect(infiniteLoopCallback).toHaveBeenCalledTimes(0)
    })
    test('should attach and remove event listeners', () => {
      const callback = vi.fn(() => 1)
      const infiniteLoopCallback = vi.fn(() => 1)
      const engineCommandManager = new ConnectionManager()
      const spyAdd = vi.spyOn(engineCommandManager, 'addEventListener')
      const spyRemove = vi.spyOn(engineCommandManager, 'removeEventListener')
      const { unmount } = renderHook(() => {
        const numberOf1006Disconnects = useRef(0)
        const actual = useOnWebsocketClose({
          callback,
          infiniteDetectionLoopCallback: infiniteLoopCallback,
          engineCommandManager,
          numberOf1006Disconnects,
        })
        return { actual }
      })
      unmount()
      expect(spyAdd).toHaveBeenCalledTimes(1)
      expect(spyRemove).toHaveBeenCalledTimes(1)
    })
    test('should call callback on close event', () => {
      const callback = vi.fn(() => 1)
      const infiniteLoopCallback = vi.fn(() => 1)
      const engineCommandManager = new ConnectionManager()
      const { unmount } = renderHook(() => {
        const numberOf1006Disconnects = useRef(0)

        const actual = useOnWebsocketClose({
          callback,
          infiniteDetectionLoopCallback: infiniteLoopCallback,
          engineCommandManager,
          numberOf1006Disconnects,
        })
        return { actual }
      })
      engineCommandManager.dispatchEvent(
        new Event(EngineCommandManagerEvents.WebsocketClosed)
      )
      unmount()
      expect(callback).toHaveBeenCalledTimes(1)
    })
    test('should call infinite detection loop callback on close event', () => {
      const callback = vi.fn(() => 1)
      const infiniteLoopCallback = vi.fn(() => 1)
      const engineCommandManager = new ConnectionManager()
      const { unmount } = renderHook(() => {
        const numberOf1006Disconnects = useRef(0)
        const actual = useOnWebsocketClose({
          callback,
          infiniteDetectionLoopCallback: infiniteLoopCallback,
          engineCommandManager,
          numberOf1006Disconnects,
        })
        return { actual }
      })
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
      expect(callback).toHaveBeenCalledTimes(1)
      expect(infiniteLoopCallback).toHaveBeenCalledTimes(0)
    })
    test('should call infinite detection loop callback on close event, 3 times', async () => {
      const callback = vi.fn(() => 1)
      const infiniteLoopCallback = vi.fn(() => 1)
      const engineCommandManager = new ConnectionManager()
      const { unmount, result } = renderHook(() => {
        const numberOf1006Disconnects = useRef(0)
        useOnWebsocketClose({
          callback,
          infiniteDetectionLoopCallback: infiniteLoopCallback,
          engineCommandManager,
          numberOf1006Disconnects,
        })
        return { numberOf1006Disconnects }
      })
      const infiniteEvent = new CustomEvent(
        EngineCommandManagerEvents.WebsocketClosed,
        {
          detail: {
            code: '1006',
          },
        }
      )
      engineCommandManager.dispatchEvent(infiniteEvent)
      engineCommandManager.dispatchEvent(infiniteEvent)
      engineCommandManager.dispatchEvent(infiniteEvent)
      unmount()
      expect(result.current.numberOf1006Disconnects.current).toBe(3)
      expect(callback).toHaveBeenCalledTimes(3)
      expect(infiniteLoopCallback).toHaveBeenCalledTimes(0)
    })
    test('should call infinite detection loop callback on close event, stops after 3', async () => {
      const callback = vi.fn(() => 1)
      const infiniteLoopCallback = vi.fn(() => 1)
      const engineCommandManager = new ConnectionManager()
      const { unmount, result } = renderHook(() => {
        const numberOf1006Disconnects = useRef(0)
        useOnWebsocketClose({
          callback,
          infiniteDetectionLoopCallback: infiniteLoopCallback,
          engineCommandManager,
          numberOf1006Disconnects,
        })
        return { numberOf1006Disconnects }
      })
      const infiniteEvent = new CustomEvent(
        EngineCommandManagerEvents.WebsocketClosed,
        {
          detail: {
            code: '1006',
          },
        }
      )
      engineCommandManager.dispatchEvent(infiniteEvent)
      engineCommandManager.dispatchEvent(infiniteEvent)
      engineCommandManager.dispatchEvent(infiniteEvent)
      engineCommandManager.dispatchEvent(infiniteEvent)
      unmount()
      expect(result.current.numberOf1006Disconnects.current).toBe(4)
      expect(callback).toHaveBeenCalledTimes(3)
      expect(infiniteLoopCallback).toHaveBeenCalledTimes(1)
    })
    test('should call infinite detection loop callback on close event, call infinite loop detection even more', async () => {
      const callback = vi.fn(() => 1)
      const infiniteLoopCallback = vi.fn(() => 1)
      const engineCommandManager = new ConnectionManager()
      const { unmount, result } = renderHook(() => {
        const numberOf1006Disconnects = useRef(0)
        useOnWebsocketClose({
          callback,
          infiniteDetectionLoopCallback: infiniteLoopCallback,
          engineCommandManager,
          numberOf1006Disconnects,
        })
        return { numberOf1006Disconnects }
      })
      const infiniteEvent = new CustomEvent(
        EngineCommandManagerEvents.WebsocketClosed,
        {
          detail: {
            code: '1006',
          },
        }
      )
      // next 3 are legit reconnects
      engineCommandManager.dispatchEvent(infiniteEvent)
      engineCommandManager.dispatchEvent(infiniteEvent)
      engineCommandManager.dispatchEvent(infiniteEvent)
      // these will trigger the manual reconnect modal, will not trigger automatic reconnection
      engineCommandManager.dispatchEvent(infiniteEvent)
      engineCommandManager.dispatchEvent(infiniteEvent)
      engineCommandManager.dispatchEvent(infiniteEvent)
      unmount()
      expect(result.current.numberOf1006Disconnects.current).toBe(6)
      expect(callback).toHaveBeenCalledTimes(3)
      expect(infiniteLoopCallback).toHaveBeenCalledTimes(3)
    })
  })
})
