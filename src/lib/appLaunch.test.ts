import { batch, signal } from '@preact/signals-core'
import {
  createAppLaunchService,
  type AppLaunchDependencies,
} from '@src/lib/appLaunch'
import { parseLaunchRequest } from '@src/lib/launchRequest'
import type { AppLaunchInput } from '@src/registry/contracts/appLaunch'
import { afterEach, describe, expect, test, vi } from 'vitest'

const disposals: (() => void)[] = []
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose()
})

function input(
  search = '?cmd=set-layout&groupId=application&ttc-prompt=make+a+gear'
): AppLaunchInput {
  const parsed = parseLaunchRequest(search)
  if (!parsed.request) throw new Error('Expected launch input')
  return {
    destination: { type: 'index' },
    urlState: { search, hash: '' },
    ...parsed,
    request: parsed.request,
  }
}

function harness(overrides: Partial<AppLaunchDependencies> = {}) {
  const isLoggedIn = signal(true)
  const intentRevision = signal(0)
  const dependencies: AppLaunchDependencies = {
    isLoggedIn,
    navigation: {
      intentRevision,
      openProject: vi.fn<AppLaunchDependencies['navigation']['openProject']>(
        async () => {
          intentRevision.value += 1
          return {
            kind: 'opened',
            data: {
              code: '',
              project: {
                name: 'gear',
                path: '/projects/gear',
                children: [],
                kcl_file_count: 1,
                directory_count: 0,
                metadata: null,
                default_file: '/projects/gear/main.kcl',
                readWriteAccess: true,
              },
            },
          }
        }
      ),
    },
    isDesktop: false,
    execute: vi.fn(async () => undefined),
    chooseWeb: vi.fn(async () => undefined),
    reportError: vi.fn(),
    ...overrides,
  }
  const launch = createAppLaunchService(dependencies)
  disposals.push(launch.dispose)
  return { launch, dependencies, isLoggedIn, intentRevision }
}

describe('application launch ownership', () => {
  test('claims a combined request once while navigation and prompt mounting are delayed', async () => {
    const finish = Promise.withResolvers<undefined>()
    const dispatch = vi.fn()
    const prefill = vi.fn()
    const { launch, dependencies, intentRevision } = harness({
      execute: async (request, execution) => {
        await execution.openProject({ target: '/projects/gear/main.kcl' })
        await finish.promise
        execution.signal.throwIfAborted()
        dispatch(request.request.genericCommand)
        prefill(request.request.zookeeperPrompt)
      },
    })
    const accepted = launch.accept(input())
    await vi.waitFor(() => expect(intentRevision.value).toBe(1))
    expect(launch.pending.value).toBe(true)
    expect(dispatch).not.toHaveBeenCalled()
    finish.resolve(undefined)
    await accepted
    expect(dispatch).toHaveBeenCalledOnce()
    expect(prefill).toHaveBeenCalledExactlyOnceWith('make a gear')
    expect(dependencies.reportError).not.toHaveBeenCalled()
    expect(launch.pending.value).toBe(false)
  })

  test('retains the original URL through authentication without blocking UI startup', async () => {
    const loggedIn = signal(false)
    const { launch, dependencies } = harness({ isLoggedIn: loggedIn })
    const request = input()
    await launch.accept(request)
    expect(dependencies.execute).not.toHaveBeenCalled()
    expect(request.urlState.search).toContain('ttc-prompt=')
    expect(launch.pending.value).toBe(true)
    loggedIn.value = true
    await vi.waitFor(() => expect(dependencies.execute).toHaveBeenCalledOnce())
    expect(dependencies.execute).toHaveBeenCalledWith(
      request,
      expect.anything()
    )
  })

  test.each([false, true])(
    'tracks owned navigation across a signal batch (followed by external navigation: %s)',
    async (externalNavigation) => {
      const dispatch = vi.fn()
      const { launch, dependencies, intentRevision } = harness({
        execute: async (_, execution) => {
          await batch(() => {
            const opening = execution.openProject({
              target: '/projects/gear/main.kcl',
            })
            if (externalNavigation) intentRevision.value += 1
            return opening
          })
          execution.signal.throwIfAborted()
          dispatch()
        },
      })
      await launch.accept(input())
      expect(dispatch).toHaveBeenCalledTimes(externalNavigation ? 0 : 1)
      expect(dependencies.reportError).not.toHaveBeenCalled()
    }
  )

  test('waits for the desktop choice replacement to commit before consuming the request', async () => {
    const chosen = Promise.withResolvers<undefined>()
    const { launch, dependencies } = harness({
      chooseWeb: vi.fn(() => chosen.promise),
    })
    await launch.accept(
      input('?ask-open-desktop&cmd=set-layout&groupId=application')
    )
    expect(dependencies.execute).not.toHaveBeenCalled()
    const continuing = launch.continueInWeb()
    const repeated = launch.continueInWeb()
    expect(repeated).toBe(continuing)
    await Promise.resolve()
    expect(dependencies.chooseWeb).toHaveBeenCalledOnce()
    expect(dependencies.execute).not.toHaveBeenCalled()
    chosen.resolve(undefined)
    await continuing
    await launch.continueInWeb()
    expect(dependencies.execute).toHaveBeenCalledOnce()
  })

  test('allows retrying the web choice after a failed URL replacement', async () => {
    const error = new Error('Navigation failed')
    const chooseWeb = vi
      .fn<AppLaunchDependencies['chooseWeb']>()
      .mockRejectedValueOnce(error)
      .mockResolvedValue(undefined)
    const { launch, dependencies } = harness({ chooseWeb })
    await launch.accept(input('?ask-open-desktop&ttc-prompt=hello'))
    await expect(launch.continueInWeb()).rejects.toThrow(error)
    expect(launch.pending.value).toBe(true)
    expect(dependencies.execute).not.toHaveBeenCalled()
    await launch.continueInWeb()
    expect(chooseWeb).toHaveBeenCalledTimes(2)
    expect(dependencies.execute).toHaveBeenCalledOnce()
  })

  test('desktop ignores the web desktop-choice gate', async () => {
    const { launch, dependencies } = harness({ isDesktop: true })
    await launch.accept(input('?ask-open-desktop&ttc-prompt=hello'))
    expect(dependencies.chooseWeb).not.toHaveBeenCalled()
    expect(dependencies.execute).toHaveBeenCalledOnce()
  })

  test('a newer navigation cancels launch work before it can open or prefill a project', async () => {
    const prepared = Promise.withResolvers<undefined>()
    const dispatch = vi.fn()
    const { launch, dependencies, intentRevision } = harness({
      execute: async (_, execution) => {
        await prepared.promise
        await execution.openProject({ target: '/projects/stale/main.kcl' })
        dispatch()
      },
    })
    const accepted = launch.accept(input())
    await Promise.resolve(undefined)
    intentRevision.value += 1
    prepared.resolve(undefined)
    await accepted
    expect(dependencies.navigation.openProject).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
    expect(dependencies.reportError).not.toHaveBeenCalled()
    expect(launch.pending.value).toBe(false)
  })

  test('a second accepted link owns completion even if the first finishes later', async () => {
    const first = Promise.withResolvers<undefined>()
    const second = Promise.withResolvers<undefined>()
    const execute = vi
      .fn<AppLaunchDependencies['execute']>()
      .mockImplementationOnce(async (_, execution) => {
        await first.promise
        execution.signal.throwIfAborted()
      })
      .mockImplementationOnce(() => second.promise)
    const { launch, dependencies } = harness({ execute })
    const firstAccepted = launch.accept(input())
    await Promise.resolve(undefined)
    const secondAccepted = launch.accept(input('?ttc-prompt=next'))
    first.resolve(undefined)
    await firstAccepted
    expect(launch.pending.value).toBe(true)
    second.resolve(undefined)
    await secondAccepted
    expect(launch.pending.value).toBe(false)
    expect(dependencies.reportError).not.toHaveBeenCalled()
  })

  test.each(['logout', 'dispose'] as const)(
    '%s stops pending command readiness',
    async (action) => {
      const aborted = vi.fn()
      const { launch, dependencies, isLoggedIn } = harness({
        execute: (_, { signal: abortSignal }) =>
          new Promise((resolve) => {
            abortSignal.addEventListener(
              'abort',
              () => {
                aborted()
                resolve()
              },
              { once: true }
            )
          }),
      })
      const accepted = launch.accept(input())
      await Promise.resolve(undefined)
      if (action === 'logout') isLoggedIn.value = false
      else launch.dispose()
      await accepted
      expect(aborted).toHaveBeenCalledOnce()
      expect(dependencies.reportError).not.toHaveBeenCalled()
      expect(launch.pending.value).toBe(false)
    }
  )

  test('reports an execution failure once and releases ownership', async () => {
    const error = new Error('Download failed')
    const { launch, dependencies } = harness({
      execute: async () => {
        throw error
      },
    })
    await launch.accept(input())
    expect(dependencies.reportError).toHaveBeenCalledExactlyOnceWith(error)
    expect(launch.pending.value).toBe(false)
  })
})
