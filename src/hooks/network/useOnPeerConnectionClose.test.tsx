import { renderHook } from '@testing-library/react'
import { useOnPeerConnectionClose } from '@src/hooks/network/useOnPeerConnectionClose'
import { vi } from 'vitest'
import { ConnectionManager } from '@src/network/connectionManager'
import { EngineCommandManagerEvents } from '@src/network/utils'

describe('useOnPageMounted tests', () => {
  describe('on mounted', () => {
    test('should not run any callbacks', () => {
      const callback = vi.fn(() => 1)
      const engineCommandManager = new ConnectionManager()
      const { unmount } = renderHook(() =>
        useOnPeerConnectionClose({
          callback,
          engineCommandManager,
        })
      )
      unmount()
      expect(callback).toHaveBeenCalledTimes(0)
    })
    test('should attach and remove event listeners', () => {
      const callback = vi.fn(() => 1)
      const engineCommandManager = new ConnectionManager()
      const spyAdd = vi.spyOn(engineCommandManager, 'addEventListener')
      const spyRemove = vi.spyOn(engineCommandManager, 'removeEventListener')
      const { unmount } = renderHook(() =>
        useOnPeerConnectionClose({
          callback,
          engineCommandManager,
        })
      )
      unmount()
      expect(spyAdd).toHaveBeenCalledTimes(4)
      expect(spyRemove).toHaveBeenCalledTimes(4)
    })
    test('should attach and remove peerConnectionClosed', () => {
      const callback = vi.fn(() => 1)
      const engineCommandManager = new ConnectionManager()
      const spyAdd = vi.spyOn(engineCommandManager, 'addEventListener')
      const spyRemove = vi.spyOn(engineCommandManager, 'removeEventListener')
      const { unmount } = renderHook(() =>
        useOnPeerConnectionClose({
          callback,
          engineCommandManager,
        })
      )
      unmount()
      expect(spyAdd).toHaveBeenNthCalledWith(
        1,
        EngineCommandManagerEvents.peerConnectionClosed,
        expect.any(Function)
      )
      expect(spyRemove).toHaveBeenNthCalledWith(
        1,
        EngineCommandManagerEvents.peerConnectionClosed,
        expect.any(Function)
      )
    })
    test('should attach and remove peerConnectionDisconnected', () => {
      const callback = vi.fn(() => 1)
      const engineCommandManager = new ConnectionManager()
      const spyAdd = vi.spyOn(engineCommandManager, 'addEventListener')
      const spyRemove = vi.spyOn(engineCommandManager, 'removeEventListener')
      const { unmount } = renderHook(() =>
        useOnPeerConnectionClose({
          callback,
          engineCommandManager,
        })
      )
      unmount()
      expect(spyAdd).toHaveBeenNthCalledWith(
        2,
        EngineCommandManagerEvents.peerConnectionDisconnected,
        expect.any(Function)
      )
      expect(spyRemove).toHaveBeenNthCalledWith(
        2,
        EngineCommandManagerEvents.peerConnectionDisconnected,
        expect.any(Function)
      )
    })
    test('should attach and remove peerConnectionFailed', () => {
      const callback = vi.fn(() => 1)
      const engineCommandManager = new ConnectionManager()
      const spyAdd = vi.spyOn(engineCommandManager, 'addEventListener')
      const spyRemove = vi.spyOn(engineCommandManager, 'removeEventListener')
      const { unmount } = renderHook(() =>
        useOnPeerConnectionClose({
          callback,
          engineCommandManager,
        })
      )
      unmount()
      expect(spyAdd).toHaveBeenNthCalledWith(
        3,
        EngineCommandManagerEvents.peerConnectionFailed,
        expect.any(Function)
      )
      expect(spyRemove).toHaveBeenNthCalledWith(
        3,
        EngineCommandManagerEvents.peerConnectionFailed,
        expect.any(Function)
      )
    })
    test('should attach and remove dataChannelClose', () => {
      const callback = vi.fn(() => 1)
      const engineCommandManager = new ConnectionManager()
      const spyAdd = vi.spyOn(engineCommandManager, 'addEventListener')
      const spyRemove = vi.spyOn(engineCommandManager, 'removeEventListener')
      const { unmount } = renderHook(() =>
        useOnPeerConnectionClose({
          callback,
          engineCommandManager,
        })
      )
      unmount()
      expect(spyAdd).toHaveBeenNthCalledWith(
        4,
        EngineCommandManagerEvents.dataChannelClose,
        expect.any(Function)
      )
      expect(spyRemove).toHaveBeenNthCalledWith(
        4,
        EngineCommandManagerEvents.dataChannelClose,
        expect.any(Function)
      )
    })
    describe('should call callback on', () => {
      test('dispatched peerConnectionClose', () => {
        const callback = vi.fn(() => 1)
        const engineCommandManager = new ConnectionManager()
        const { unmount } = renderHook(() =>
          useOnPeerConnectionClose({
            callback,
            engineCommandManager,
          })
        )
        engineCommandManager.dispatchEvent(
          new CustomEvent(EngineCommandManagerEvents.peerConnectionClosed)
        )
        unmount()
        expect(callback).toHaveBeenCalledTimes(1)
      })
      test('dispatched peerConnectionDisconnected', () => {
        const callback = vi.fn(() => 1)
        const engineCommandManager = new ConnectionManager()
        const { unmount } = renderHook(() =>
          useOnPeerConnectionClose({
            callback,
            engineCommandManager,
          })
        )
        engineCommandManager.dispatchEvent(
          new CustomEvent(EngineCommandManagerEvents.peerConnectionDisconnected)
        )
        unmount()
        expect(callback).toHaveBeenCalledTimes(1)
      })
      test('dispatched peerConnectionFailed', () => {
        const callback = vi.fn(() => 1)
        const engineCommandManager = new ConnectionManager()
        const { unmount } = renderHook(() =>
          useOnPeerConnectionClose({
            callback,
            engineCommandManager,
          })
        )
        engineCommandManager.dispatchEvent(
          new CustomEvent(EngineCommandManagerEvents.peerConnectionFailed)
        )
        unmount()
        expect(callback).toHaveBeenCalledTimes(1)
      })
      test('dispatched dataChannelClose', () => {
        const callback = vi.fn(() => 1)
        const engineCommandManager = new ConnectionManager()
        const { unmount } = renderHook(() =>
          useOnPeerConnectionClose({
            callback,
            engineCommandManager,
          })
        )
        engineCommandManager.dispatchEvent(
          new CustomEvent(EngineCommandManagerEvents.dataChannelClose)
        )
        unmount()
        expect(callback).toHaveBeenCalledTimes(1)
      })
    })
  })
})
