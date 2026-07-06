import { signal } from '@preact/signals-core'
import type { Project } from '@src/lib/project'
import {
  createSystemIOAbortError,
  createSystemIOOperationQueue,
  type SystemIOOperationHandlerContext,
  type SystemIOOperationQueueOptions,
} from '@src/lib/systemIO/operationQueue'
import type {
  ProjectHandle,
  ProjectHandles,
  Projects,
  SystemIOOperation,
  SystemIORefreshProjectsRequest,
  SystemIORequest,
  SystemIORequestResult,
  SystemIOService,
} from '@src/lib/systemIO/registry/contract'
import { SystemIOMachineEvents } from '@src/machines/systemIO/events'
import type { SystemIOActor, SystemIOInput } from '@src/machines/systemIO/utils'

export type SystemIOProjectsReaderInput = {
  readonly projectDirectoryPath: string
  readonly previousProjects?: readonly Project[]
  readonly signal: AbortSignal
  readonly onProgress?: (projects: readonly Project[]) => void
}

export type SystemIOProjectsReader = (
  input: SystemIOProjectsReaderInput,
  context: SystemIOOperationHandlerContext
) => Promise<readonly Project[]>

export type SystemIOServiceDependencies = {
  createActor: (input: SystemIOInput) => SystemIOActor
  readProjectsFromProjectDirectory: SystemIOProjectsReader
}

export type SystemIOServiceOptions = SystemIOOperationQueueOptions

export type SystemIOServiceImplementation = SystemIOService & {
  dispose: () => void
}

function getAbortError(signal: AbortSignal) {
  return signal.aborted ? createSystemIOAbortError() : undefined
}

function projectHandlesFromProjects(projects: readonly Project[]) {
  return projects.map<ProjectHandle>((project) => ({ path: project.path }))
}

export function createSystemIOService(
  dependencies: SystemIOServiceDependencies,
  options: SystemIOServiceOptions = {}
): SystemIOServiceImplementation {
  const queue = createSystemIOOperationQueue<SystemIORequest>(options)
  const projectHandles = signal<ProjectHandles>(undefined)
  const projects = signal<Projects>(undefined)
  let actor: SystemIOActor | undefined
  let actorSubscription: { unsubscribe: () => void } | undefined
  let latestRefreshId = 0

  const setProjects = (nextProjects: readonly Project[] | undefined) => {
    projectHandles.value = nextProjects
      ? projectHandlesFromProjects(nextProjects)
      : undefined
    projects.value = nextProjects
  }

  const syncActorFolders = (nextProjects: readonly Project[]) => {
    actor?.send({
      type: SystemIOMachineEvents.setFolders,
      data: { folders: [...nextProjects] },
    })
  }

  const requestRefreshProjects = (request: SystemIORefreshProjectsRequest) => {
    return queue.enqueue(
      {
        request,
        resourceKey: `project-directory:${request.input.projectDirectoryPath}`,
        coalesceKey: `projects.refresh:${request.input.projectDirectoryPath}`,
      },
      async (context) => {
        const refreshId = ++latestRefreshId
        const setCurrentProjects = (nextProjects: readonly Project[]) => {
          if (refreshId !== latestRefreshId) {
            return
          }
          setProjects(nextProjects)
          syncActorFolders(nextProjects)
        }
        const nextProjects =
          await dependencies.readProjectsFromProjectDirectory(
            {
              projectDirectoryPath: request.input.projectDirectoryPath,
              previousProjects: projects.value,
              signal: context.signal,
              onProgress: setCurrentProjects,
            },
            context
          )
        const projectsAbortError = getAbortError(context.signal)
        if (projectsAbortError) {
          return Promise.reject(projectsAbortError)
        }

        setCurrentProjects(nextProjects)
        return nextProjects
      }
    )
  }

  const requestOperation: SystemIOService['request'] = <
    TRequest extends SystemIORequest,
  >(
    systemIORequest: TRequest
  ) => {
    switch (systemIORequest.type) {
      case 'projects.refresh':
        return requestRefreshProjects(systemIORequest) as SystemIOOperation<
          SystemIORequestResult<TRequest>,
          TRequest
        >
    }
  }

  return {
    get actor() {
      return actor
    },
    operations: queue.operations,
    projectHandles,
    projects,
    startActor: (input) => {
      if (actor) {
        return actor
      }

      actor = dependencies.createActor(input)
      actorSubscription = actor.subscribe((snapshot) => {
        setProjects(snapshot.context.folders)
      })
      return actor
    },
    request: requestOperation,
    dispose: () => {
      actorSubscription?.unsubscribe()
      actorSubscription = undefined
      actor?.stop()
      actor = undefined
    },
  }
}
