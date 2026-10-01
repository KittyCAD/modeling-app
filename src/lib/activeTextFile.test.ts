import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readFile:
    vi.fn<(path: string, options: unknown) => Promise<string | Uint8Array>>(),
  stat: vi.fn(),
  writeFile: vi.fn<(path: string, data: Uint8Array) => Promise<void>>(),
  basename: vi.fn((path: string) => path.slice(path.lastIndexOf('/') + 1)),
  reportSystemIOError: vi.fn(),
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

vi.mock('@src/machines/systemIO/errorReporting', () => ({
  reportSystemIOError: mocks.reportSystemIOError,
}))

const importModule = () => import('@src/lib/activeTextFile')
let mod: Awaited<ReturnType<typeof importModule>>

const fileOperations = {
  stat: mocks.stat,
  readFile: async (path: string) => {
    const contents = await mocks.readFile(path, undefined)
    return typeof contents === 'string'
      ? new TextEncoder().encode(contents)
      : contents
  },
  writeFile: (path: string, contents: string | Uint8Array) =>
    mocks.writeFile(
      path,
      typeof contents === 'string'
        ? new TextEncoder().encode(contents)
        : contents
    ),
} as unknown as FileOperationsRegistryService

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
  mocks.stat.mockResolvedValue({ size: 0 })
  mocks.writeFile.mockResolvedValue(undefined)
  mod = await importModule()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('text file detection', () => {
  it('opens and saves UTF-8 text', async () => {
    const path = '/proj/project.toml'
    mocks.readFile.mockResolvedValueOnce('original')
    await mod.openActiveTextFile(fileOperations, path)
    expect(mod.activeTextFileSignal.value).toMatchObject({
      path,
      status: 'ready',
      text: 'original',
    })
    mod.scheduleActiveTextFileWrite(fileOperations, path, 'edited')
    await mod.flushActiveTextFileWrite()
    expect(mocks.writeFile).toHaveBeenCalledWith(
      path,
      new TextEncoder().encode('edited')
    )
  })

  it.each([
    ['PNG signature', new Uint8Array([0x89, 0x50, 0x4e, 0x47])],
    ['invalid UTF-8', new Uint8Array([0xc3, 0x28])],
    ['UTF-16 BOM', new Uint8Array([0xff, 0xfe, 0x61, 0])],
    ['NUL byte', new Uint8Array([0x61, 0, 0x62])],
    ['escape control character', new Uint8Array([0x61, 0x1b, 0x62])],
    [
      'NUL after 16 KiB',
      new TextEncoder().encode('text'.repeat(4096) + '\u0000'),
    ],
  ])('rejects %s even with a text extension', async (_name, bytes) => {
    mocks.readFile.mockResolvedValueOnce(bytes)
    await mod.openActiveTextFile(fileOperations, '/proj/readme.md')
    expect(mod.activeTextFileSignal.value).toMatchObject({
      status: 'error',
      text: '',
      error: 'This file is binary or is not UTF-8 text.',
    })
    mod.scheduleActiveTextFileWrite(fileOperations, '/proj/readme.md', '')
    await mod.flushActiveTextFileWrite()
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it('accepts empty files, Unicode, whitespace and a UTF-8 BOM', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.oneof(
            fc.integer({ min: 32, max: 126 }),
            fc.integer({ min: 160, max: 0xd7ff }),
            fc.integer({ min: 0xe000, max: 0x10ffff }),
            fc.constantFrom(9, 10, 13)
          ),
          { maxLength: 100 }
        ),
        async (codePoints) => {
          const text = String.fromCodePoint(...codePoints)
          mocks.readFile.mockResolvedValueOnce(text)
          await mod.openActiveTextFile(fileOperations, '/proj/README')
          expect(mod.activeTextFileSignal.value).toMatchObject({
            status: 'ready',
            text,
          })
        }
      )
    )
    const text = '\ufefftitle = "Example"\r\n'
    mocks.readFile.mockResolvedValueOnce(text)
    await mod.openActiveTextFile(fileOperations, '/proj/config.toml')
    expect(mod.activeTextFileSignal.value).toMatchObject({
      status: 'ready',
      text,
    })
  })

  it('rejects oversized files before reading them', async () => {
    mocks.stat.mockResolvedValueOnce({
      size: mod.MAX_EDITABLE_TEXT_FILE_BYTES + 1,
    })
    await mod.openActiveTextFile(fileOperations, '/proj/large.log')
    expect(mocks.readFile).not.toHaveBeenCalled()
    expect(mod.activeTextFileSignal.value).toMatchObject({
      status: 'error',
      error: 'Text files larger than 1 MiB cannot be edited.',
    })
  })

  it('rejects files that grow past the limit between stat and read', async () => {
    mocks.readFile.mockResolvedValueOnce(
      new Uint8Array(mod.MAX_EDITABLE_TEXT_FILE_BYTES + 1).fill(97)
    )
    await mod.openActiveTextFile(fileOperations, '/proj/growing.log')
    expect(mod.activeTextFileSignal.value).toMatchObject({
      status: 'error',
      error: 'Text files larger than 1 MiB cannot be edited.',
    })
  })

  it('accepts a file exactly at the size limit', async () => {
    const text = 'a'.repeat(mod.MAX_EDITABLE_TEXT_FILE_BYTES)
    mocks.stat.mockResolvedValueOnce({ size: mod.MAX_EDITABLE_TEXT_FILE_BYTES })
    mocks.readFile.mockResolvedValueOnce(text)
    await mod.openActiveTextFile(fileOperations, '/proj/boundary.txt')
    expect(mod.activeTextFileSignal.value).toMatchObject({
      status: 'ready',
      text,
    })
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

    const promise = mod.openActiveTextFile(fileOperations, '/proj/readme.md')
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

    await mod.openActiveTextFile(fileOperations, '/proj/readme.md')

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

    const promiseA = mod.openActiveTextFile(fileOperations, '/proj/a.md')
    await flushMicrotasks()
    const promiseB = mod.openActiveTextFile(fileOperations, '/proj/b.md')
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
    await mod.openActiveTextFile(fileOperations, path)
  }

  it('debounces rapid edits into a single write of the latest text', async () => {
    vi.useFakeTimers()
    await openReady('/proj/readme.md')

    mod.scheduleActiveTextFileWrite(fileOperations, '/proj/readme.md', 'a')
    mod.scheduleActiveTextFileWrite(fileOperations, '/proj/readme.md', 'ab')
    mod.scheduleActiveTextFileWrite(fileOperations, '/proj/readme.md', 'abc')
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

    mod.scheduleActiveTextFileWrite(fileOperations, '/proj/other.md', 'nope')
    await vi.advanceTimersByTimeAsync(1000)

    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it('swallows path-not-found errors (file deleted underneath)', async () => {
    vi.useFakeTimers()
    await openReady('/proj/readme.md')
    mocks.writeFile.mockRejectedValueOnce({ code: 'ENOENT' })

    mod.scheduleActiveTextFileWrite(fileOperations, '/proj/readme.md', 'edited')
    // Must not throw / reject even though the write fails with ENOENT.
    await vi.advanceTimersByTimeAsync(1000)

    expect(mocks.writeFile).toHaveBeenCalledTimes(1)
    expect(mocks.reportSystemIOError).not.toHaveBeenCalled()
  })

  it('reports autosave failures without including the path or contents', async () => {
    vi.useFakeTimers()
    await openReady('/proj/readme.md')
    const error = new Error('permission denied')
    mocks.writeFile.mockRejectedValueOnce(error)

    mod.scheduleActiveTextFileWrite(
      fileOperations,
      '/proj/readme.md',
      'private contents'
    )
    await vi.advanceTimersByTimeAsync(1000)

    expect(mocks.reportSystemIOError).toHaveBeenCalledWith({
      error,
      operation: 'save_text_file',
      risk: 'write',
      source: 'ActiveTextFile',
      extra: {
        phase: 'write',
        contentLength: 16,
      },
    })
    expect(JSON.stringify(mocks.reportSystemIOError.mock.calls)).not.toContain(
      '/proj/readme.md'
    )
    expect(JSON.stringify(mocks.reportSystemIOError.mock.calls)).not.toContain(
      'private contents'
    )
  })
})

describe('flushActiveTextFileWrite', () => {
  it('writes the pending edit immediately and cancels the timer', async () => {
    vi.useFakeTimers()
    mocks.readFile.mockResolvedValueOnce('initial')
    await mod.openActiveTextFile(fileOperations, '/proj/readme.md')

    mod.scheduleActiveTextFileWrite(
      fileOperations,
      '/proj/readme.md',
      'flushed'
    )
    await mod.flushActiveTextFileWrite()

    expect(mocks.writeFile).toHaveBeenCalledTimes(1)
    expect(decode(mocks.writeFile.mock.calls[0][1])).toBe('flushed')

    // The debounce timer must not fire a second (duplicate) write.
    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.writeFile).toHaveBeenCalledTimes(1)
  })
})

describe('switching files', () => {
  it('does not reopen a file after clearing during a pending save', async () => {
    await mod.openActiveTextFile(fileOperations, '/proj/a.txt')
    mod.scheduleActiveTextFileWrite(fileOperations, '/proj/a.txt', 'edited')
    const save = Promise.withResolvers<undefined>()
    mocks.writeFile.mockReturnValueOnce(save.promise)
    const opening = mod.openActiveTextFile(fileOperations, '/proj/b.json')
    await flushMicrotasks()

    mod.clearActiveTextFile()
    save.resolve(undefined)
    await opening
    expect(mod.activeTextFileSignal.value).toBeNull()
    expect(mocks.readFile).not.toHaveBeenCalledWith('/proj/b.json', undefined)
  })

  it('discards a pending stat when another file opens', async () => {
    const stat = Promise.withResolvers<{ size: number }>()
    mocks.stat.mockReturnValueOnce(stat.promise)
    const opening = mod.openActiveTextFile(fileOperations, '/proj/a.json')
    await flushMicrotasks()
    await mod.openActiveTextFile(fileOperations, '/proj/b.yaml')

    stat.resolve({ size: 0 })
    await opening
    expect(mocks.readFile).not.toHaveBeenCalledWith('/proj/a.json', undefined)
    expect(mod.activeTextFileSignal.value).toMatchObject({
      path: '/proj/b.yaml',
      status: 'ready',
    })
  })

  it('persists pending edits to the outgoing file before opening a new one', async () => {
    mocks.readFile.mockResolvedValueOnce('A')
    await mod.openActiveTextFile(fileOperations, '/proj/a.md')
    mod.scheduleActiveTextFileWrite(fileOperations, '/proj/a.md', 'A edited')

    // Opening B must flush A's edit to A's own path first.
    mocks.readFile.mockResolvedValueOnce('B')
    await mod.openActiveTextFile(fileOperations, '/proj/b.md')

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
    await mod.openActiveTextFile(fileOperations, '/proj/a.md')
    mod.scheduleActiveTextFileWrite(fileOperations, '/proj/a.md', 'A edited')

    mod.clearActiveTextFile()
    await flushMicrotasks()

    expect(mod.activeTextFileSignal.value).toBeNull()
    expect(mocks.writeFile).toHaveBeenCalledTimes(1)
    expect(mocks.writeFile.mock.calls[0][0]).toBe('/proj/a.md')
    expect(decode(mocks.writeFile.mock.calls[0][1])).toBe('A edited')
  })
})
