import { type ReadonlySignal, effect } from '@preact/signals'

export interface AutoConnectDependencies {
  /** The open project's id, or null when none is open. */
  project: ReadonlySignal<string | null>
  /** Whether that project has a buffer to render. */
  executing: ReadonlySignal<boolean>
  /** Whether there is a token to connect with. */
  signedIn: ReadonlySignal<boolean>
  /** Whether the connection is idle — not connected, connecting, or failed. */
  offline: ReadonlySignal<boolean>
  connect: () => Promise<void>
}

/**
 * Connect when a project opens with something to render.
 *
 * Opening a project lands in a file, and a KCL file on screen is a request to
 * see the geometry — leaving that behind a button meant every session began with
 * the same click for no decision.
 *
 * Four conditions, each guarding against a distinct kind of annoyance:
 *
 * - Something executing, because a project whose default file did not resolve
 *   has nothing to show and a connection it does not need.
 * - Signed in already. The engine's own command asks for an account when
 *   somebody has asked for the engine; asking unprompted, because a project
 *   happened to open, would turn "usable signed out" into a sign-in wall on
 *   launch.
 * - Once per project, tracked by id rather than a boolean, so switching projects
 *   connects again while an explicit disconnect stays disconnected.
 * - Offline only, so a failed attempt is not retried in a loop.
 */
export function autoConnectOnProjectOpen(
  dependencies: AutoConnectDependencies
): () => void {
  const { project, executing, signedIn, offline, connect } = dependencies

  let connectedFor: string | null = null

  return effect(() => {
    const projectId = project.value

    if (projectId === null) {
      // Closing the project forgets the attempt: opening it again is a new
      // intention, not a repeat of the one already served.
      connectedFor = null
      return
    }

    if (!executing.value) return
    if (connectedFor === projectId) return
    if (!signedIn.value) return
    if (!offline.value) return

    connectedFor = projectId
    void connect().catch((error) => {
      // The status field reports the failure; an unhandled rejection would only
      // report it to the console, twice.
      console.warn('engine: could not connect for this project', error)
    })
  })
}
