import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type EditorCapability,
  combineCapabilities,
} from '@src/contracts/buffers'
import { bufferOrigin } from '@src/lib/buffers/annotations'
import { createFileBackedTextBuffer } from '@src/lib/buffers/createFileBackedTextBuffer'
import { createPresence } from '@src/lib/collab/presence'

const PATH = 'main.kcl'
const WRITER = 'zookeeper:c1'

const bufferWith = (contents = 'width = 10\n') =>
  createFileBackedTextBuffer({
    path: PATH,
    contents,
    languageId: 'kcl',
    capabilities: combineCapabilities([] as EditorCapability[]),
  })

/** A clock the test moves, so nothing here waits in real time. */
function clock(start = 1_000) {
  let value = start
  return {
    now: () => value,
    advance: (by: number) => {
      value += by
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createPresence', () => {
  it('reports nobody at the start', () => {
    const presence = createPresence()

    expect(presence.here.value.size).toBe(0)
    expect(presence.at(PATH).value).toBeNull()
    presence.dispose()
  })

  it('records a remote writer touching a file', () => {
    const time = clock()
    const presence = createPresence({ now: time.now })

    presence.record(PATH, WRITER)

    expect(presence.at(PATH).value).toEqual({ author: WRITER, at: 1_000 })
    presence.dispose()
  })

  /**
   * Presence answers "who is here now". A list of everybody who has ever touched
   * a file is a different question.
   */
  it('forgets somebody who has not written for a while', () => {
    vi.useFakeTimers()
    const time = clock()
    const presence = createPresence({ now: time.now, windowMs: 5_000 })
    presence.record(PATH, WRITER)

    time.advance(6_000)
    // The tick is what invalidates the computed; without it presence would only
    // ever arrive and never leave.
    vi.advanceTimersByTime(1_000)

    expect(presence.at(PATH).value).toBeNull()
    presence.dispose()
  })

  it('keeps somebody who wrote inside the window', () => {
    vi.useFakeTimers()
    const time = clock()
    const presence = createPresence({ now: time.now, windowMs: 5_000 })
    presence.record(PATH, WRITER)

    time.advance(2_000)
    vi.advanceTimersByTime(1_000)

    expect(presence.at(PATH).value?.author).toBe(WRITER)
    presence.dispose()
  })

  it('follows a buffer and records what a writer does to it', () => {
    const time = clock()
    const presence = createPresence({ now: time.now })
    const buffer = bufferWith()
    presence.follow(PATH, buffer)

    buffer.dispatch({
      changes: { from: 0, insert: 'depth = 2\n' },
      annotations: bufferOrigin.of({
        role: 'semantic',
        author: WRITER,
        contributionId: 'turn-1',
      }),
    })

    expect(presence.at(PATH).value?.author).toBe(WRITER)
    presence.dispose()
  })

  /**
   * The local user is not present to themselves, and saying so would put their
   * own name in a panel telling them who else is here.
   */
  it('ignores the local user’s own typing', () => {
    const presence = createPresence()
    const buffer = bufferWith()
    presence.follow(PATH, buffer)

    buffer.dispatch({ changes: { from: 0, insert: '// mine\n' } })

    expect(presence.at(PATH).value).toBeNull()
    presence.dispose()
  })

  it('ignores a change that moved no text', () => {
    const presence = createPresence()
    const buffer = bufferWith()
    presence.follow(PATH, buffer)

    buffer.dispatch({
      selection: { anchor: 2 },
      annotations: bufferOrigin.of({ role: 'semantic', author: WRITER }),
    })

    expect(presence.at(PATH).value).toBeNull()
    presence.dispose()
  })

  it('tracks separate paths separately', () => {
    const presence = createPresence()

    presence.record('main.kcl', WRITER)

    expect(presence.at('main.kcl').value?.author).toBe(WRITER)
    expect(presence.at('lid.kcl').value).toBeNull()
    presence.dispose()
  })

  it('reports the most recent writer for a path', () => {
    const time = clock()
    const presence = createPresence({ now: time.now })

    presence.record(PATH, WRITER)
    time.advance(100)
    presence.record(PATH, 'zookeeper:c2')

    expect(presence.at(PATH).value?.author).toBe('zookeeper:c2')
    presence.dispose()
  })

  it('stops recording once the follow is disposed', () => {
    const presence = createPresence()
    const buffer = bufferWith()
    const dispose = presence.follow(PATH, buffer)
    dispose()

    buffer.dispatch({
      changes: { from: 0, insert: 'x' },
      annotations: bufferOrigin.of({ role: 'semantic', author: WRITER }),
    })

    expect(presence.at(PATH).value).toBeNull()
    presence.dispose()
  })

  it('does not double-record when a path is followed twice', () => {
    const presence = createPresence()
    const buffer = bufferWith()
    presence.follow(PATH, buffer)
    presence.follow(PATH, buffer)

    buffer.dispatch({
      changes: { from: 0, insert: 'x' },
      annotations: bufferOrigin.of({ role: 'semantic', author: WRITER }),
    })

    expect(presence.here.value.size).toBe(1)
    presence.dispose()
  })

  it('goes quiet on dispose', () => {
    const presence = createPresence()
    presence.record(PATH, WRITER)

    presence.dispose()

    expect(presence.here.value.size).toBe(0)
  })
})
