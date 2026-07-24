import type { Project } from '@src/lib/project'
import {
  createSystemIOService,
  type SystemIOProjectsReader,
  type SystemIOProjectsReaderInput,
} from '@src/lib/systemIO/service'
import { SystemIOMachineEvents } from '@src/machines/systemIO/events'
import type { SystemIOActor } from '@src/machines/systemIO/utils'
import { describe, expect, it, vi } from 'vitest'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0))

function createProject(path: string): Project {
  return {
    metadata: null,
    kcl_file_count: 1,
    directory_count: 0,
    default_file: `${path}/main.kcl`,
    path,
    name: path.slice(path.lastIndexOf('/') + 1) || path,
    children: [],
    readWriteAccess: true,
  }
}

function createServiceOptions() {
  let id = 0
  let time = 0

  return {
    createId: () => `operation-${++id}`,
    now: () => ++time,
  }
}

function refreshProjectsRequest(projectDirectoryPath: string) {
  return {
    type: 'projects.refresh' as const,
    input: { projectDirectoryPath },
  }
}

function createSystemIOActor() {
  let folders: Project[] | undefined
  const subscribers = new Set<
    (snapshot: { context: { folders?: Project[] } }) => void
  >()
  const actor = {
    send: vi.fn((event: { type: string; data?: { folders?: Project[] } }) => {
      if (event.type !== SystemIOMachineEvents.setFolders) {
        return
      }
      folders = event.data?.folders
      for (const subscriber of subscribers) {
        subscriber({ context: { folders } })
      }
    }),
    subscribe: vi.fn(
      (
        subscriber: (snapshot: { context: { folders?: Project[] } }) => void
      ) => {
        subscribers.add(subscriber)
        return {
          unsubscribe: () => {
            subscribers.delete(subscriber)
          },
        }
      }
    ),
    stop: vi.fn(),
  }

  return actor as unknown as SystemIOActor & typeof actor
}

function createTestSystemIOService(
  readProjectsFromProjectDirectory: SystemIOProjectsReader,
  options = createServiceOptions()
) {
  const actor = createSystemIOActor()
  const createActor = vi.fn(() => actor)
  const systemIO = createSystemIOService(
    {
      createActor,
      readProjectsFromProjectDirectory,
    },
    options
  )

  return {
    actor,
    createActor,
    systemIO,
  }
}

describe('systemIO service', () => {
  it('refreshes projects through injected dependencies', async () => {
    const projects = [createProject('/projects/bracket')]
    const readProjectsFromProjectDirectory = vi.fn(async () => projects)
    const { systemIO } = createTestSystemIOService(
      readProjectsFromProjectDirectory
    )

    const operation = systemIO.request(refreshProjectsRequest('/projects'))

    await expect(operation.result).resolves.toBe(projects)

    expect(readProjectsFromProjectDirectory).toHaveBeenCalledWith(
      expect.objectContaining({
        projectDirectoryPath: '/projects',
        previousProjects: undefined,
        signal: expect.any(AbortSignal),
        onProgress: expect.any(Function),
      }),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      })
    )
    expect(systemIO.projectHandles.value).toEqual([
      { path: '/projects/bracket' },
    ])
    expect(systemIO.projects.value).toBe(projects)
    expect(systemIO.operations.value).toEqual([
      expect.objectContaining({
        id: 'operation-1',
        status: 'succeeded',
        request: expect.objectContaining({
          type: 'projects.refresh',
          input: { projectDirectoryPath: '/projects' },
        }),
      }),
    ])
  })

  it('publishes refresh progress while the request is running', async () => {
    const progress = [createProject('/projects/bracket')]
    const projects = [...progress, createProject('/projects/gears')]
    const readProjectsFromProjectDirectory = vi.fn(
      async ({ onProgress }: SystemIOProjectsReaderInput) => {
        onProgress?.(progress)
        return projects
      }
    )
    const { systemIO } = createTestSystemIOService(
      readProjectsFromProjectDirectory
    )

    await expect(
      systemIO.request(refreshProjectsRequest('/projects')).result
    ).resolves.toBe(projects)

    expect(systemIO.projects.value).toBe(projects)
    expect(systemIO.projectHandles.value).toEqual([
      { path: '/projects/bracket' },
      { path: '/projects/gears' },
    ])
  })

  it('coalesces duplicate project refreshes from multiple consumers', async () => {
    const pendingProjects = deferred<Project[]>()
    const projects = [createProject('/projects/bracket')]
    const readProjectsFromProjectDirectory = vi.fn(
      () => pendingProjects.promise
    )
    const { systemIO } = createTestSystemIOService(
      readProjectsFromProjectDirectory
    )

    const firstOperation = systemIO.request(refreshProjectsRequest('/projects'))
    const secondOperation = systemIO.request(
      refreshProjectsRequest('/projects')
    )

    expect(secondOperation).toBe(firstOperation)

    await flushPromises()
    expect(readProjectsFromProjectDirectory).toHaveBeenCalledTimes(1)

    pendingProjects.resolve(projects)

    await expect(firstOperation.result).resolves.toBe(projects)
    expect(readProjectsFromProjectDirectory).toHaveBeenCalledTimes(1)
  })

  it('does not let stale refresh results overwrite newer refresh state', async () => {
    const oldProjects = deferred<Project[]>()
    const newProjects = deferred<Project[]>()
    const readProjectsFromProjectDirectory = vi.fn(
      ({ projectDirectoryPath }: SystemIOProjectsReaderInput) =>
        projectDirectoryPath === '/old'
          ? oldProjects.promise
          : newProjects.promise
    )
    const { systemIO } = createTestSystemIOService(
      readProjectsFromProjectDirectory
    )

    const oldOperation = systemIO.request(refreshProjectsRequest('/old'))
    const newOperation = systemIO.request(refreshProjectsRequest('/new'))

    await flushPromises()

    const newProjectResult = [createProject('/new/bracket')]
    newProjects.resolve(newProjectResult)

    await expect(newOperation.result).resolves.toBe(newProjectResult)
    expect(systemIO.projectHandles.value).toEqual([{ path: '/new/bracket' }])
    expect(systemIO.projects.value).toBe(newProjectResult)

    const oldProjectResult = [createProject('/old/bracket')]
    oldProjects.resolve(oldProjectResult)

    await expect(oldOperation.result).resolves.toBe(oldProjectResult)
    expect(systemIO.projectHandles.value).toEqual([{ path: '/new/bracket' }])
    expect(systemIO.projects.value).toBe(newProjectResult)
  })

  it('keeps previous state when a refresh fails', async () => {
    const initialProjects = [createProject('/projects/bracket')]
    const readProjectsFromProjectDirectory = vi
      .fn()
      .mockResolvedValueOnce(initialProjects)
      .mockRejectedValueOnce(new Error('could not read projects'))
    const { systemIO } = createTestSystemIOService(
      readProjectsFromProjectDirectory
    )

    await expect(
      systemIO.request(refreshProjectsRequest('/projects')).result
    ).resolves.toBe(initialProjects)

    await expect(
      systemIO.request(refreshProjectsRequest('/projects')).result
    ).rejects.toThrow('could not read projects')

    expect(systemIO.projects.value).toBe(initialProjects)
    expect(systemIO.operations.value.at(-1)).toEqual(
      expect.objectContaining({
        status: 'failed',
        error: expect.any(Error),
      })
    )
  })

  it('owns the legacy actor lifecycle', () => {
    const readProjectsFromProjectDirectory = vi.fn()
    const { actor, createActor, systemIO } = createTestSystemIOService(
      readProjectsFromProjectDirectory
    )
    const input = {
      wasmInstancePromise: Promise.resolve({}),
      app: {},
    }

    expect(systemIO.actor).toBeUndefined()
    expect(systemIO.startActor(input as never)).toBe(actor)
    expect(systemIO.startActor(input as never)).toBe(actor)
    expect(createActor).toHaveBeenCalledTimes(1)
    expect(systemIO.actor).toBe(actor)

    systemIO.dispose()

    expect(actor.stop).toHaveBeenCalledTimes(1)
    // The stopped actor stays reachable so late consumers (e.g.
    // `app.systemIOActor`) don't crash on a `send`/`subscribe` after dispose.
    expect(systemIO.actor).toBe(actor)
  })

  it('ignores actor snapshots without folder data', async () => {
    const projects = [createProject('/projects/bracket')]
    const readProjectsFromProjectDirectory = vi.fn(async () => projects)
    const { actor, systemIO } = createTestSystemIOService(
      readProjectsFromProjectDirectory
    )

    systemIO.startActor({
      wasmInstancePromise: Promise.resolve({}),
      app: {},
    } as never)

    await expect(
      systemIO.request(refreshProjectsRequest('/projects')).result
    ).resolves.toBe(projects)
    expect(systemIO.projects.value).toEqual(projects)

    // A snapshot that carries no folder data (e.g. an unrelated actor event
    // while the machine sits idle) must not wipe the loaded project list.
    actor.send({
      type: SystemIOMachineEvents.setFolders,
      data: { folders: undefined },
    })

    expect(systemIO.projects.value).toEqual(projects)
    expect(systemIO.projectHandles.value).toEqual([
      { path: '/projects/bracket' },
    ])
  })

  it('syncs service refresh results into the legacy actor bridge', async () => {
    const projects = [createProject('/projects/bracket')]
    const readProjectsFromProjectDirectory = vi.fn(async () => projects)
    const { actor, systemIO } = createTestSystemIOService(
      readProjectsFromProjectDirectory
    )

    systemIO.startActor({
      wasmInstancePromise: Promise.resolve({}),
      app: {},
    } as never)

    await expect(
      systemIO.request(refreshProjectsRequest('/projects')).result
    ).resolves.toBe(projects)

    expect(actor.send).toHaveBeenCalledWith({
      type: SystemIOMachineEvents.setFolders,
      data: { folders: projects },
    })
    expect(systemIO.projects.value).toEqual(projects)
  })

  it('syncs legacy actor folders back into service signals', () => {
    const readProjectsFromProjectDirectory = vi.fn()
    const { actor, systemIO } = createTestSystemIOService(
      readProjectsFromProjectDirectory
    )
    const projects = [createProject('/projects/bracket')]

    systemIO.startActor({
      wasmInstancePromise: Promise.resolve({}),
      app: {},
    } as never)
    actor.send({
      type: SystemIOMachineEvents.setFolders,
      data: { folders: projects },
    })

    expect(systemIO.projects.value).toEqual(projects)
    expect(systemIO.projectHandles.value).toEqual([
      { path: '/projects/bracket' },
    ])
  })
})
