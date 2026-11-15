import { signal } from '@preact/signals-core'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { KclConnectionStatus } from '@src/lib/kcl/KclConnectionStatus'
import type { KclSceneResource, OpenKclScene } from '@src/lib/kcl/scene'
import { createKclSession } from '@src/lib/kcl/session'
import type { KclSceneSettings } from '@src/lib/kcl/settings'

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
})
afterEach(() => vi.unstubAllGlobals())

it.each(['streamed', 'local'] as const)(
  'retries a failed %s scene through its owner and removes connection UI when ready',
  async (presentation) => {
    const first = Promise.withResolvers<KclSceneResource | Error>()
    const retry = Promise.withResolvers<KclSceneResource | Error>()
    const open = vi
      .fn<OpenKclScene>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(retry.promise)
    const refresh = vi.fn()
    const session = createKclSession(open, refresh)
    const container = document.createElement('div')
    Object.defineProperties(container, {
      clientWidth: { value: 200 },
      clientHeight: { value: 150 },
    })
    session.mount(container)
    const resource = {
      element: document.createElement('div'),
      presentation,
      preferences: signal({} as KclSceneSettings),
      resize: async () => {},
      resume: () => {},
      applySettings: async () => {},
      isConnected: () => true,
      dispose: async () => {},
    } as unknown as KclSceneResource
    const mounted = render(<KclConnectionStatus session={session} />)
    try {
      expect(
        screen.getByText('Connecting and setting up scene...')
      ).toBeInTheDocument()
      await act(async () => {
        first.resolve(new Error('The scene connection was refused'))
      })
      expect(screen.getByRole('alert')).toHaveTextContent(
        'The scene connection was refused'
      )
      expect(screen.getByRole('link')).toHaveAttribute(
        'href',
        'https://status.zoo.dev'
      )
      fireEvent.click(screen.getByRole('button', { name: /Reconnect$/ }))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(
        screen.getByText('Connecting and setting up scene...')
      ).toBeInTheDocument()
      session.reconnect()
      await act(async () => {
        retry.resolve(resource)
      })
      expect(screen.queryByTestId('loading-engine')).not.toBeInTheDocument()
      expect(session.resource.peek()).toBe(resource)
      expect(open).toHaveBeenCalledTimes(2)
      expect(refresh).toHaveBeenCalledOnce()
      session.reconnect()
      expect(session.resource.peek()).toBe(resource)
      expect(open).toHaveBeenCalledTimes(2)
    } finally {
      mounted.unmount()
      session.dispose()
    }
  }
)
