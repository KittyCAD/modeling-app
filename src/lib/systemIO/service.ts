import { signal } from '@preact/signals-core'
import type { Project } from '@src/lib/project'
import { scanProjectDirectoryRequest } from '@src/lib/systemIO/registry/contract'
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
  SystemIOScanProjectDirectoryRequest,
  SystemIORequest,
  SystemIORequestOptions,
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
  // `projects`/`projectHandles` model a single legacy "current" project
  // directory. Arbitrary library scans share this queue but must not publish
  // into that compatibility state unless explicitly requested.
  let latestPublishedScanId = 0

  const setProjects = (nextProjects: readonly Project[] | undefined) => {
    projectHandles.value = nextProjects
      ? projectHandlesFromProjects(nextProjects)
      : undefined
    projects.value = nextProjects
  }

  const syncActorFolders = (
    nextProjects: readonly Project[],
    projectDirectoryPath: string
  ) => {
    actor?.send({
      type: SystemIOMachineEvents.setFolders,
      data: { folders: [...nextProjects], projectDirectoryPath },
    })
  }

  const requestScanProjectDirectory = (
    request: SystemIOScanProjectDirectoryRequest
  ) => {
    const shouldPublish = Boolean(
      request.input.publishToCurrentProjectDirectory
    )
    return queue.enqueue(
      {
        request,
        resourceKey: `project-directory:${request.input.projectDirectoryPath}`,
        coalesceKey: `projectDirectory.scan:${request.input.projectDirectoryPath}:${shouldPublish ? 'publish' : 'read'}`,
      },
      async (context) => {
        const publishedScanId = shouldPublish
          ? ++latestPublishedScanId
          : undefined
        const setCurrentProjects = (nextProjects: readonly Project[]) => {
          if (!shouldPublish || publishedScanId !== latestPublishedScanId) {
            return
          }
          setProjects(nextProjects)
          syncActorFolders(nextProjects, request.input.projectDirectoryPath)
        }
        const nextProjects =
          await dependencies.readProjectsFromProjectDirectory(
            {
              projectDirectoryPath: request.input.projectDirectoryPath,
              previousProjects: shouldPublish ? projects.value : undefined,
              signal: context.signal,
              onProgress: shouldPublish ? setCurrentProjects : undefined,
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

  const bindExternalSignal = <TResult, TRequest extends SystemIORequest>(
    operation: SystemIOOperation<TResult, TRequest>,
    options: SystemIORequestOptions = {}
  ) => {
    const signal = options.signal
    if (!signal) {
      return operation.result
    }

    if (signal.aborted) {
      operation.cancel()
      return operation.result
    }

    const cancelOperation = () => operation.cancel()
    signal.addEventListener('abort', cancelOperation, { once: true })
    return operation.result.finally(() => {
      signal.removeEventListener('abort', cancelOperation)
    })
  }

  const requestOperation: SystemIOService['request'] = <
    TRequest extends SystemIORequest,
  >(
    systemIORequest: TRequest
  ) => {
    switch (systemIORequest.type) {
      case 'projectDirectory.scan':
        return requestScanProjectDirectory(
          systemIORequest
        ) as SystemIOOperation<SystemIORequestResult<TRequest>, TRequest>
    }
  }

  return {
    get actor() {
      return actor
    },
    operations: queue.operations,
    operationRecordLimit: queue.recordLimit,
    projectHandles,
    projects,
    scanProjectDirectory: (input, options) =>
      bindExternalSignal(
        requestOperation(scanProjectDirectoryRequest(input)),
        options
      ),
    startActor: (input) => {
      if (actor) {
        return actor
      }

      actor = dependencies.createActor(input)
      actorSubscription = actor.subscribe((snapshot) => {
        // The actor emits a snapshot on every event, including ones that don't
        // touch `folders` (which is `undefined` until it has loaded projects).
        // Only mirror actual folder data so an unrelated snapshot can't clobber
        // the freshly-loaded project list back to undefined.
        if (snapshot.context.folders === undefined) {
          return
        }
        setProjects(snapshot.context.folders)
      })
      return actor
    },
    request: requestOperation,
    dispose: () => {
      actorSubscription?.unsubscribe()
      actorSubscription = undefined
      // Stop the actor but keep the reference: a stopped actor absorbs late
      // `send`/`subscribe` calls without throwing, whereas clearing it would
      // make `app.systemIOActor` undefined and crash any lingering consumer.
      actor?.stop()
    },
  }
}
