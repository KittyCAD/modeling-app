import type { Editor } from '@src/lib/editors/registry/contract'
import type { ExecutorRunContext } from '@src/lib/executors/registry/contract'
import fsZds from '@src/lib/fs-zds'
import type { ProjectSessionService } from '@src/lib/projectSession/next/contract'
import { isErr } from '@src/lib/trap'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'

/** Immutable bytes for one execution, with open buffers taking precedence over storage. */
export interface KclSourceSnapshot {
  readonly src: string
  readonly files: ReadonlyMap<string, Uint8Array>
}

export async function loadKclSources(
  contents: string,
  { src, signal }: ExecutorRunContext,
  projects: ProjectSessionService | undefined,
  editors: readonly Editor[],
  operations: Pick<FileOperationsRegistryService, 'readFile'> | undefined,
  include: (path: string) => boolean = () => true
): Promise<KclSourceSnapshot | Error> {
  const entrypoint = src || 'main.kcl'
  const session = projects?.currentSession.peek()
  const snapshots = new Map<string, Uint8Array>()
  const encode = (value: string) => new TextEncoder().encode(value)
  for (const open of editors) {
    const path = open.src.peek()
    if (path && !snapshots.has(path))
      snapshots.set(path, encode(open.contents.peek()))
  }
  snapshots.set(entrypoint, encode(contents))
  if (!session || !projects) return { src: entrypoint, files: snapshots }
  const files = projects.listFiles()
  const root = session.project.peek().contents.path
  if (src && !files.some((file) => file.path === src))
    return new Error('The executed file is no longer in the project')
  const cancelled = () =>
    signal.aborted ||
    session.signal.aborted ||
    projects.currentSession.peek() !== session
  try {
    const bytes = new Map<string, Uint8Array>()
    for (const file of files) {
      if (file.path !== src && !include(file.path)) continue
      if (cancelled()) return new Error('KCL execution was cancelled')
      const snapshot = snapshots.get(file.path)
      const data =
        snapshot ??
        (operations
          ? await operations.readFile(file.path)
          : encode(await session.files.read(fsZds.relative(root, file.path))))
      if (cancelled()) return new Error('KCL execution was cancelled')
      bytes.set(fsZds.join(file.path), data.slice())
    }
    bytes.set(fsZds.join(entrypoint), encode(contents))
    return { src: entrypoint, files: bytes }
  } catch (cause) {
    return isErr(cause)
      ? cause
      : new Error('Unable to read the KCL project', { cause })
  }
}
