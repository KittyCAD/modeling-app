/**
 * What the renderer and the language-server worker say to each other.
 *
 * Three conversations share one channel, and keeping them distinct in the type
 * is what stops the router in the middle from guessing:
 *
 * - **Protocol traffic**, which is the point: JSON-RPC message bodies, already
 *   unframed, in both directions.
 * - **Lifecycle**, so the renderer knows whether there is a server to talk to.
 * - **Filesystem requests**, because the server resolves KCL imports and the
 *   worker has no filesystem — on desktop the real one is behind granted roots
 *   in the main process, and on the web it is an origin-private filesystem the
 *   renderer owns.
 */

export type FsMethod = 'readFile' | 'readTextFile' | 'exists' | 'getAllFiles'

export type ToWorker =
  | {
      kind: 'start'
      token: string
      apiBaseUrl: string
      /** Absolute path of the open project, which the server resolves against. */
      projectPath: string
    }
  | { kind: 'message'; json: string }
  | { kind: 'fsResult'; id: number; value: unknown }
  | { kind: 'fsError'; id: number; error: string }

export type FromWorker =
  | { kind: 'ready' }
  | { kind: 'failed'; error: string }
  | { kind: 'message'; json: string }
  | { kind: 'fsRequest'; id: number; method: FsMethod; path: string }
