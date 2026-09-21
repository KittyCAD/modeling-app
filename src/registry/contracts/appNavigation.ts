import { defineContract, defineService } from '@kittycad/registry'
import type { IndexLoaderData } from '@src/lib/types'

/**
 * An application-level request to enter a project.
 *
 * `target` is deliberately broader than a file path while the existing
 * `/file/*` URL shape is supported. Resolving that legacy target into a project
 * and optional initial editor is the coordinator's responsibility.
 */
export interface OpenProjectRequest {
  target?: string
  requestUrl?: string
  signal?: AbortSignal
}

export type OpenProjectOutcome =
  | { kind: 'opened'; data: IndexLoaderData }
  /**
   * Transitional loader-compatible result used while React Router still
   * initiates project opens. The final inversion replaces this with opening
   * normalized project state and projecting its canonical URL afterward.
   */
  | { kind: 'redirect'; to: string }

/**
 * Coordinates application intents without owning durable application state.
 *
 * Project and editor lifecycle belongs to `projectSession`; this service only
 * resolves requests and delegates to the capability that owns the result.
 */
export interface AppNavigationService {
  openProject: (request: OpenProjectRequest) => Promise<OpenProjectOutcome>
  supersedeProjectOpen: (signal?: AbortSignal) => void
}

export const appNavigationContract = defineContract({
  appNavigationService: defineService<AppNavigationService>(
    'application-navigation'
  ),
})

export const { appNavigationService } = appNavigationContract
