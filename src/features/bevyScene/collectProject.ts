import type { FileSystem } from '@src/contracts/fileSystem'
import type { ProjectSession } from '@src/contracts/projectSession'
import type { ProjectFile } from '@src/contracts/projects'

export interface KclProjectPayload {
  entrypoint: string
  files: Record<string, string>
}

/**
 * The whole project as text, keyed by path relative to its root.
 *
 * Every file has to be here. bevy-zoo sends the project to Zoo's engine to be
 * solved, and the engine cannot see this machine's disk — so a file the
 * entrypoint imports but nobody has opened still has to be read and sent.
 *
 * Disk is the source, then unsaved buffers are laid over it. The other way round
 * would render the last saved version of whatever is being edited, which reads as
 * the renderer being broken rather than as the file being dirty.
 */
export async function collectProject(
  session: ProjectSession,
  fileSystem: FileSystem
): Promise<KclProjectPayload | null> {
  const executing = session.executingBuffer.value
  if (!executing) return null

  const root = session.project.value.path
  const paths = kclPaths(session.files.value)

  /** Unsaved text, by path, for the KCL buffers that have one. */
  const unsaved = new Map<string, string>()
  for (const buffer of session.buffers.value) {
    if (buffer.languageId.value !== 'kcl') continue
    const path = buffer.path.value
    if (path) unsaved.set(path, buffer.text.value)
  }

  const files: Record<string, string> = {}
  await Promise.all(
    paths.map(async (path) => {
      const overlay = unsaved.get(path)
      const contents =
        overlay ?? (await fileSystem.readTextFileIfPresent(path)) ?? null
      if (contents === null) return
      files[relativeTo(root, path)] = contents
    })
  )

  /**
   * An unsaved buffer has no path, so it is named rather than located. It still
   * has to appear in `files`, or the entrypoint names something absent.
   */
  const executingPath = executing.path.value
  const entrypoint = executingPath
    ? relativeTo(root, executingPath)
    : executing.name.value
  if (!(entrypoint in files)) {
    files[entrypoint] = executing.text.value
  }

  return { entrypoint, files }
}

function kclPaths(files: readonly ProjectFile[]): string[] {
  const found: string[] = []
  const walk = (entries: readonly ProjectFile[]) => {
    for (const entry of entries) {
      if (entry.kind === 'directory') {
        walk(entry.children ?? [])
      } else if (entry.name.endsWith('.kcl')) {
        found.push(entry.path)
      }
    }
  }
  walk(files)
  return found
}

/** Both separators, because a project opened on Windows carries backslashes. */
function relativeTo(root: string, path: string): string {
  const normalise = (value: string) => value.replace(/\\/g, '/')
  const from = normalise(root).replace(/\/$/, '')
  const to = normalise(path)
  return to.startsWith(`${from}/`) ? to.slice(from.length + 1) : to
}
