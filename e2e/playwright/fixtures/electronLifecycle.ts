import type { ChildProcess } from 'node:child_process'
import { execFile } from 'node:child_process'
import type { ElectronApplication } from '@playwright/test'

const ELECTRON_CLOSE_TIMEOUT = 5_000

// Electron is launched by Playwright in its own process group (or a Windows
// process tree). Only terminate the process owned by this fixture.
export async function closeElectronApplication(
  application: ElectronApplication
) {
  // Playwright removes its process handle when the application closes.
  let child: ChildProcess | undefined
  try {
    child = application.process()
  } catch {
    // A repeated disposal may already have a closed Playwright connection.
  }
  let timer: NodeJS.Timeout | undefined
  const close = Promise.resolve()
    .then(() => application.close())
    .then(
      () => ({ kind: 'closed' as const }),
      (error: unknown) => ({ kind: 'error' as const, error })
    )

  try {
    const outcome = await Promise.race([
      close,
      new Promise<{ kind: 'timeout' }>((resolve) => {
        timer = setTimeout(
          () => resolve({ kind: 'timeout' }),
          ELECTRON_CLOSE_TIMEOUT
        )
      }),
    ])
    if (outcome.kind === 'closed') {
      return
    }

    if (!child) {
      if (outcome.kind === 'error') {
        throw outcome.error
      }
      throw new Error(
        'Cannot terminate an Electron fixture without its process'
      )
    }
    if (child.exitCode === null && child.signalCode === null) {
      const pid = child.pid
      if (!pid || !Number.isInteger(pid) || pid <= 0) {
        throw new Error('Cannot terminate an Electron fixture without its PID')
      }
      console.warn('Terminating the unresponsive Electron fixture process')
      if (process.platform === 'win32') {
        const ownedProcess = child
        await new Promise<void>((resolve, reject) => {
          execFile(
            'taskkill',
            ['/pid', String(pid), '/T', '/F'],
            { timeout: ELECTRON_CLOSE_TIMEOUT },
            (error) => {
              // The process can exit naturally while taskkill is starting.
              if (
                error &&
                ownedProcess.exitCode === null &&
                ownedProcess.signalCode === null
              ) {
                reject(error)
              } else {
                resolve()
              }
            }
          )
        })
      } else {
        try {
          process.kill(-pid, 'SIGKILL')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
            throw error
          }
        }
      }
    }
    if (outcome.kind === 'error') {
      throw outcome.error
    }
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

export async function runElectronSetup(
  setup: () => Promise<void>,
  dispose: () => Promise<void>,
  timeoutMs: number,
  timeoutMessage: string
) {
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      Promise.resolve().then(setup),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
      }),
    ])
  } catch (error) {
    try {
      await dispose()
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Electron fixture setup and cleanup failed'
      )
    }
    throw error
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}
