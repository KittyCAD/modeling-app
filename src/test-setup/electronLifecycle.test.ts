import {
  closeElectronApplication,
  runElectronSetup,
} from '@e2e/playwright/fixtures/electronLifecycle'
import type { ElectronApplication } from '@playwright/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }))
vi.mock('node:child_process', () => ({
  execFile: execFileMock,
  default: { execFile: execFileMock },
}))

const killMock = vi.fn(() => true as const)
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
if (!platformDescriptor) {
  throw new Error('Missing Node.js platform property')
}

beforeEach(() => {
  vi.useFakeTimers()
  killMock.mockClear()
  vi.spyOn(process, 'kill').mockImplementation(killMock)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  execFileMock.mockReset()
  Object.defineProperty(process, 'platform', platformDescriptor)
})

describe('Electron fixture setup cleanup', () => {
  it('does not dispose a successful setup or leave its deadline timer active', async () => {
    const dispose = vi.fn()
    await runElectronSetup(async () => {}, dispose, 30_000, 'setup deadline')
    expect(dispose).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('closes a timed-out setup before propagating its original timeout', async () => {
    let rejectNavigation!: (error: Error) => void
    const navigation = new Promise<void>((_, reject) => {
      rejectNavigation = reject
    })
    const dispose = vi.fn(async () => {
      rejectNavigation(new Error('Navigation cancelled by context close'))
    })
    const outcome = runElectronSetup(
      () => navigation,
      dispose,
      30_000,
      'setup deadline'
    ).catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(await outcome).toEqual(new Error('setup deadline'))
    expect(dispose).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('disposes a crashed setup and preserves the crash error', async () => {
    const crash = new Error('page.reload: Page crashed')
    const dispose = vi.fn(async () => {})
    await expect(
      runElectronSetup(
        () => Promise.reject(crash),
        dispose,
        30_000,
        'setup deadline'
      )
    ).rejects.toBe(crash)
    expect(dispose).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retains both setup and cleanup errors if disposal fails', async () => {
    const setupError = new Error('setup failed')
    const cleanupError = new Error('cleanup failed')
    const result = await runElectronSetup(
      () => Promise.reject(setupError),
      () => Promise.reject(cleanupError),
      30_000,
      'setup deadline'
    ).catch((error: unknown) => error)
    expect(result).toBeInstanceOf(AggregateError)
    expect((result as AggregateError).errors).toEqual([
      setupError,
      cleanupError,
    ])
  })
})

function application(close: () => Promise<void>, exited = false) {
  return {
    close,
    process: () => ({
      pid: 123456,
      exitCode: exited ? 0 : null,
      signalCode: null,
    }),
  } as unknown as ElectronApplication
}

describe('closing the owned Electron application', () => {
  it('allows a graceful close without terminating any process', async () => {
    await closeElectronApplication(application(async () => {}))
    expect(killMock).not.toHaveBeenCalled()
    expect(execFileMock).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds a stuck close and terminates only the owned Unix process group', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    const close = closeElectronApplication(
      application(() => new Promise(() => {}))
    )
    await vi.advanceTimersByTimeAsync(4_999)
    expect(killMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await close
    expect(killMock).toHaveBeenCalledExactlyOnceWith(-123456, 'SIGKILL')
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('uses a bounded taskkill for only the owned Windows process tree', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    execFileMock.mockImplementation(
      (
        _command: string,
        _args: string[],
        _options: unknown,
        done: (error: null) => void
      ) => done(null)
    )
    const close = closeElectronApplication(
      application(() => new Promise(() => {}))
    )
    await vi.advanceTimersByTimeAsync(5_000)
    await close
    expect(execFileMock).toHaveBeenCalledExactlyOnceWith(
      'taskkill',
      ['/pid', '123456', '/T', '/F'],
      { timeout: 5_000 },
      expect.any(Function)
    )
    expect(killMock).not.toHaveBeenCalled()
  })

  it('accepts a Windows process exiting while taskkill starts', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const ownedProcess = {
      pid: 123456,
      exitCode: null as number | null,
      signalCode: null,
    }
    const app = {
      close: () => new Promise<void>(() => {}),
      process: () => ownedProcess,
    } as unknown as ElectronApplication
    execFileMock.mockImplementation(
      (
        _command: string,
        _args: string[],
        _options: unknown,
        done: (error: Error) => void
      ) => {
        ownedProcess.exitCode = 0
        done(new Error('Process not found'))
      }
    )
    const close = closeElectronApplication(app)
    await vi.advanceTimersByTimeAsync(5_000)
    await expect(close).resolves.toBeUndefined()
    expect(killMock).not.toHaveBeenCalled()
  })

  it('refuses to terminate a process without a valid owned PID', async () => {
    const app = {
      close: () => new Promise<void>(() => {}),
      process: () => ({ pid: 0, exitCode: null, signalCode: null }),
    } as unknown as ElectronApplication
    const result = closeElectronApplication(app).catch(
      (error: unknown) => error
    )
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await result).toEqual(
      new Error('Cannot terminate an Electron fixture without its PID')
    )
    expect(killMock).not.toHaveBeenCalled()
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('does not signal a process that has already exited', async () => {
    const close = closeElectronApplication(
      application(() => new Promise(() => {}), true)
    )
    await vi.advanceTimersByTimeAsync(5_000)
    await close
    expect(killMock).not.toHaveBeenCalled()
    expect(execFileMock).not.toHaveBeenCalled()
  })
})
