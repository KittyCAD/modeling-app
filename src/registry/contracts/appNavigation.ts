import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { IndexLoaderData } from '@src/lib/types'
import type { AppUrlState } from '@src/registry/contracts/appUrl'

/**
 * An application-level request to enter a project.
 *
 * `target` is deliberately broader than a file path while the existing
 * `/file/*` URL shape is supported. Resolving that legacy target into a project
 * and optional initial editor is the coordinator's responsibility.
 */
export interface OpenProjectRequest {
  target: string
  /** Cancellation owned by an application workflow, independent of the router. */
  signal?: AbortSignal
  /** Parsed URL-owned state, present only while restoring cold startup. */
  startup?: AppUrlState
}

export type OpenProjectOutcome = { kind: 'opened'; data: IndexLoaderData }

/**
 * Coordinates application intents without owning durable application state.
 *
 * Project and editor lifecycle belongs to `projectSession`; this service only
 * resolves requests and delegates to the capability that owns the result.
 */
export interface AppNavigationService {
  /** Changes when a new navigation begins, before asynchronous preparation. */
  readonly intentRevision: ReadonlySignal<number>
  openProject: (request: OpenProjectRequest) => Promise<OpenProjectOutcome>
  showHome: () => Promise<void>
}

export const appNavigationContract = defineContract({
  appNavigationService: defineService<AppNavigationService>(
    'application-navigation'
  ),
})

export const { appNavigationService } = appNavigationContract
