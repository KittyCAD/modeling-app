import { renderHook } from '@testing-library/react'
import { useOnPeerConnectionClose } from '@src/hooks/network/useOnPeerConnectionClose'
import { expect, vi, describe, test } from 'vitest'
import { EngineCommandManagerEvents } from '@src/network/utils'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'

describe('useOnPeerConnectionClose', () => {
  describe('on mounted', () => {
    test('should not run any callbacks', async () => {
      const callback = vi.fn(() => 1)
      const { engineCommandManager } =
        await buildTheWorldAndNoEngineConnection(true)
      const { unmount } = renderHook(() =>
        useOnPeerConnectionClose({
          callback,
          engineCommandManager,
        })
      )
      unmount()
      expect(callback).toHaveBeenCalledTimes(0)
    })
    test('should attach and remove event listeners', async () => {
      const callback = vi.fn(() => 1)
      const { engineCommandManager } =
        await buildTheWorldAndNoEngineConnection(true)
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
    test('should attach and remove peerConnectionClosed', async () => {
      const callback = vi.fn(() => 1)
      const { engineCommandManager } =
        await buildTheWorldAndNoEngineConnection(true)
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
    test('should attach and remove peerConnectionDisconnected', async () => {
      const callback = vi.fn(() => 1)
      const { engineCommandManager } =
        await buildTheWorldAndNoEngineConnection(true)
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
    test('should attach and remove peerConnectionFailed', async () => {
      const callback = vi.fn(() => 1)
      const { engineCommandManager } =
        await buildTheWorldAndNoEngineConnection(true)
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
    test('should attach and remove dataChannelClose', async () => {
      const callback = vi.fn(() => 1)
      const { engineCommandManager } =
        await buildTheWorldAndNoEngineConnection(true)
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
      test('dispatched peerConnectionClose', async () => {
        const callback = vi.fn(() => 1)
        const { engineCommandManager } =
          await buildTheWorldAndNoEngineConnection(true)
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
      test('dispatched peerConnectionDisconnected', async () => {
        const callback = vi.fn(() => 1)
        const { engineCommandManager } =
          await buildTheWorldAndNoEngineConnection(true)
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
      test('dispatched peerConnectionFailed', async () => {
        const callback = vi.fn(() => 1)
        const { engineCommandManager } =
          await buildTheWorldAndNoEngineConnection(true)
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
      test('dispatched dataChannelClose', async () => {
        const callback = vi.fn(() => 1)
        const { engineCommandManager } =
          await buildTheWorldAndNoEngineConnection(true)
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
