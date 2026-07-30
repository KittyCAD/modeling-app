import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readFile: vi.fn<(path: string, options: unknown) => Promise<string>>(),
  writeFile: vi.fn<(path: string, data: Uint8Array) => Promise<void>>(),
  basename: vi.fn((path: string) => path.slice(path.lastIndexOf('/') + 1)),
}))

vi.mock('@src/lib/fs-zds', () => ({
  default: {
    readFile: mocks.readFile,
    writeFile: mocks.writeFile,
    basename: mocks.basename,
  },
}))

vi.mock('@src/lib/desktop', () => ({
  isPathNotFoundError: (error: unknown) =>
    error === 'ENOENT' ||
    (typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'),
}))

const importModule = () => import('@src/lib/activeTextFile')
let mod: Awaited<ReturnType<typeof importModule>>

/** Flush the microtask queue (works under both real and fake timers). */
function flushMicrotasks() {
  return Promise.resolve().then(() => Promise.resolve())
}

function decode(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes)
}

beforeEach(async () => {
  // Fresh module state (signal, pending write, request id) for each test.
  vi.resetModules()
  vi.clearAllMocks()
  mocks.readFile.mockResolvedValue('')
  mocks.writeFile.mockResolvedValue(undefined)
  mod = await importModule()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('isEditableTextFile', () => {
  it('matches .md/.txt case-insensitively and rejects other files', () => {
    expect(mod.isEditableTextFile('/proj/readme.md')).toBe(true)
    expect(mod.isEditableTextFile('/proj/README.MD')).toBe(true)
    expect(mod.isEditableTextFile('/proj/notes.txt')).toBe(true)
    expect(mod.isEditableTextFile('/proj/main.kcl')).toBe(false)
    expect(mod.isEditableTextFile('/proj/model.stp')).toBe(false)
    expect(mod.isEditableTextFile('/proj/some-folder')).toBe(false)
  })
})

describe('openActiveTextFile', () => {
  it('transitions loading -> ready with the file contents', async () => {
    let resolveRead!: (value: string) => void
    mocks.readFile.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveRead = resolve
      })
    )

    const promise = mod.openActiveTextFile('/proj/readme.md')
    await flushMicrotasks()

    expect(mod.activeTextFileSignal.value).toEqual({
      path: '/proj/readme.md',
      name: 'readme.md',
      text: '',
      status: 'loading',
    })

    resolveRead('hello world')
    await promise

    expect(mod.activeTextFileSignal.value).toEqual({
      path: '/proj/readme.md',
      name: 'readme.md',
      text: 'hello world',
      status: 'ready',
    })
  })

  it('transitions to error when the read fails', async () => {
    mocks.readFile.mockRejectedValueOnce(new Error('boom'))

    await mod.openActiveTextFile('/proj/readme.md')

    expect(mod.activeTextFileSignal.value).toEqual({
      path: '/proj/readme.md',
      name: 'readme.md',
      text: '',
      status: 'error',
      error: 'boom',
    })
  })

  it('discards a stale read when a newer file is opened (race)', async () => {
    let resolveA!: (value: string) => void
    let resolveB!: (value: string) => void
    mocks.readFile
      .mockReturnValueOnce(
        new Promise<string>((resolve) => {
          resolveA = resolve
        })
      )
      .mockReturnValueOnce(
        new Promise<string>((resolve) => {
          resolveB = resolve
        })
      )

    const promiseA = mod.openActiveTextFile('/proj/a.md')
    await flushMicrotasks()
    const promiseB = mod.openActiveTextFile('/proj/b.md')
    await flushMicrotasks()

    resolveB('B contents')
    await promiseB
    expect(mod.activeTextFileSignal.value).toMatchObject({
      path: '/proj/b.md',
      status: 'ready',
      text: 'B contents',
    })

    // A resolves last but is stale — it must not clobber B.
    resolveA('A contents')
    await promiseA
    expect(mod.activeTextFileSignal.value).toMatchObject({
      path: '/proj/b.md',
      status: 'ready',
      text: 'B contents',
    })
  })
})

describe('scheduleActiveTextFileWrite', () => {
  async function openReady(path: string, contents = 'initial') {
    mocks.readFile.mockResolvedValueOnce(contents)
    await mod.openActiveTextFile(path)
  }

  it('debounces rapid edits into a single write of the latest text', async () => {
    vi.useFakeTimers()
    await openReady('/proj/readme.md')

    mod.scheduleActiveTextFileWrite('/proj/readme.md', 'a')
    mod.scheduleActiveTextFileWrite('/proj/readme.md', 'ab')
    mod.scheduleActiveTextFileWrite('/proj/readme.md', 'abc')
    expect(mocks.writeFile).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1000)

    expect(mocks.writeFile).toHaveBeenCalledTimes(1)
    const [path, bytes] = mocks.writeFile.mock.calls[0]
    expect(path).toBe('/proj/readme.md')
    expect(decode(bytes)).toBe('abc')
  })

  it('ignores writes for a file that is no longer active', async () => {
    vi.useFakeTimers()
    await openReady('/proj/readme.md')

    mod.scheduleActiveTextFileWrite('/proj/other.md', 'nope')
    await vi.advanceTimersByTimeAsync(1000)

    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it('swallows path-not-found errors (file deleted underneath)', async () => {
    vi.useFakeTimers()
    await openReady('/proj/readme.md')
    mocks.writeFile.mockRejectedValueOnce({ code: 'ENOENT' })

    mod.scheduleActiveTextFileWrite('/proj/readme.md', 'edited')
    // Must not throw / reject even though the write fails with ENOENT.
    await vi.advanceTimersByTimeAsync(1000)

    expect(mocks.writeFile).toHaveBeenCalledTimes(1)
  })
})

describe('flushActiveTextFileWrite', () => {
  it('writes the pending edit immediately and cancels the timer', async () => {
    vi.useFakeTimers()
    mocks.readFile.mockResolvedValueOnce('initial')
    await mod.openActiveTextFile('/proj/readme.md')

    mod.scheduleActiveTextFileWrite('/proj/readme.md', 'flushed')
    await mod.flushActiveTextFileWrite()

    expect(mocks.writeFile).toHaveBeenCalledTimes(1)
    expect(decode(mocks.writeFile.mock.calls[0][1])).toBe('flushed')

    // The debounce timer must not fire a second (duplicate) write.
    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.writeFile).toHaveBeenCalledTimes(1)
  })
})

describe('switching files', () => {
  it('persists pending edits to the outgoing file before opening a new one', async () => {
    mocks.readFile.mockResolvedValueOnce('A')
    await mod.openActiveTextFile('/proj/a.md')
    mod.scheduleActiveTextFileWrite('/proj/a.md', 'A edited')

    // Opening B must flush A's edit to A's own path first.
    mocks.readFile.mockResolvedValueOnce('B')
    await mod.openActiveTextFile('/proj/b.md')

    expect(mocks.writeFile).toHaveBeenCalledTimes(1)
    expect(mocks.writeFile.mock.calls[0][0]).toBe('/proj/a.md')
    expect(decode(mocks.writeFile.mock.calls[0][1])).toBe('A edited')
    expect(mod.activeTextFileSignal.value).toMatchObject({
      path: '/proj/b.md',
      status: 'ready',
      text: 'B',
    })
  })

  it('clearActiveTextFile persists pending edits and clears the signal', async () => {
    mocks.readFile.mockResolvedValueOnce('A')
    await mod.openActiveTextFile('/proj/a.md')
    mod.scheduleActiveTextFileWrite('/proj/a.md', 'A edited')

    mod.clearActiveTextFile()
    await flushMicrotasks()

    expect(mod.activeTextFileSignal.value).toBeNull()
    expect(mocks.writeFile).toHaveBeenCalledTimes(1)
    expect(mocks.writeFile.mock.calls[0][0]).toBe('/proj/a.md')
    expect(decode(mocks.writeFile.mock.calls[0][1])).toBe('A edited')
  })
})
