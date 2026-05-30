import { describe, expect, it } from 'vitest'

import {
  type DeviceFlowSession,
  DeviceFlowSessionStore,
} from '@src/lib/deviceFlowSessions'

type TestHandle = {
  abort: () => void
  abortCount: number
}

type TestWindow = {
  id: string
}

const createWindow = (id: string): TestWindow => ({ id })

const createSession = (): DeviceFlowSession<TestHandle> => ({
  handle: {
    abortCount: 0,
    abort() {
      this.abortCount += 1
    },
  },
  verificationUri: 'https://zoo.dev/device',
})

describe('DeviceFlowSessionStore', () => {
  it('keeps sessions isolated by window', () => {
    const store = new DeviceFlowSessionStore<TestWindow, TestHandle>()
    const firstWindow = createWindow('first')
    const secondWindow = createWindow('second')
    const firstSession = createSession()
    const secondSession = createSession()

    store.set(firstWindow, firstSession)
    store.set(secondWindow, secondSession)

    expect(store.get(firstWindow)).toBe(firstSession)
    expect(store.get(secondWindow)).toBe(secondSession)
  })

  it('aborts the previous session when the same window starts over', () => {
    const store = new DeviceFlowSessionStore<TestWindow, TestHandle>()
    const window = createWindow('retry')
    const oldSession = createSession()
    const newSession = createSession()

    store.set(window, oldSession)
    store.set(window, newSession)

    expect(oldSession.handle.abortCount).toBe(1)
    expect(newSession.handle.abortCount).toBe(0)
    expect(store.get(window)).toBe(newSession)
  })

  it('aborts and removes only the closed window session', () => {
    const store = new DeviceFlowSessionStore<TestWindow, TestHandle>()
    const closedWindow = createWindow('closed')
    const stillOpenWindow = createWindow('still-open')
    const closedSession = createSession()
    const stillOpenSession = createSession()

    store.set(closedWindow, closedSession)
    store.set(stillOpenWindow, stillOpenSession)
    store.abort(closedWindow)

    expect(closedSession.handle.abortCount).toBe(1)
    expect(stillOpenSession.handle.abortCount).toBe(0)
    expect(store.get(closedWindow)).toBeUndefined()
    expect(store.get(stillOpenWindow)).toBe(stillOpenSession)
  })

  it('does not let an old poll delete a newer retry session', () => {
    const store = new DeviceFlowSessionStore<TestWindow, TestHandle>()
    const window = createWindow('race')
    const oldSession = createSession()
    const newSession = createSession()

    store.set(window, oldSession)
    store.set(window, newSession)
    store.deleteIfCurrent(window, oldSession)

    expect(store.get(window)).toBe(newSession)
  })

  it('deletes the session when the active poll finishes', () => {
    const store = new DeviceFlowSessionStore<TestWindow, TestHandle>()
    const window = createWindow('active')
    const session = createSession()

    store.set(window, session)
    store.deleteIfCurrent(window, session)

    expect(store.get(window)).toBeUndefined()
  })
})
