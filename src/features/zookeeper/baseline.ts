import type { FileSystem } from '@src/contracts/fileSystem'
import type { ProjectFile } from '@src/contracts/projects'
import type { ProjectSession } from '@src/contracts/projectSession'
import { joinPath } from '@src/lib/paths'

/** Extensions worth sending. Everything else is noise the model pays for. */
const SENDABLE = ['.kcl', '.md', '.toml', '.txt', '.json']

/**
 * Capture the project as the service should see it.
 *
 * **Open buffers come from the snapshot, not from disk**, so unsaved edits are
 * included — the whole point of `captureSnapshot` being O(1) over persistent
 * documents. Everything else is read from the filesystem. The two halves have to
 * be one coherent picture, because this same content is both sent to the service
 * *and* used as the baseline every diff for the turn is measured against; sending
 * one thing and diffing against another is how the model and the app end up
 * disagreeing about what is on disk.
 *
 * The snapshot is taken **synchronously, first**, before any `await`, so the
 * buffer half is one instant rather than a smear across however long the disk
 * reads take.
 *
 * Unreadable files are skipped rather than failing the capture. A project with
 * one unreadable file should still be answerable questions about, and the
 * alternative — refusing the whole turn — is worse than a slightly smaller
 * context.
 */
export async function captureProjectBaseline(input: {
  session: ProjectSession
  fileSystem: FileSystem
  /** Which files are worth sending. Defaults to text formats the model can use. */
  sendable?: (path: string) => boolean
}): Promise<ReadonlyMap<string, string>> {
  const { session, fileSystem, sendable = isSendable } = input

  /*
   * First and synchronous. Everything below awaits, and a buffer captured after
   * an await is a buffer captured at a different moment than its neighbours.
   */
  const snapshot = session.captureSnapshot()
  const captured = new Map<string, string>()

  for (const buffer of snapshot.buffers) {
    if (buffer.path === null) continue
    const relative = relativeTo(snapshot.projectPath, buffer.path)
    if (relative === null || !sendable(relative)) continue
    captured.set(relative, buffer.content)
  }

  const projectPath = snapshot.projectPath
  const onDisk = flatten(session.files.peek()).filter(
    (path) => sendable(path) && !captured.has(path)
  )

  await Promise.all(
    onDisk.map(async (path) => {
      try {
        const contents = await fileSystem.readTextFile(
          joinPath(projectPath, path)
        )
        captured.set(path, contents)
      } catch {
        // Skipped, deliberately. See the note above about not failing the turn
        // over one file.
      }
    })
  )

  return captured
}

function isSendable(path: string): boolean {
  const lower = path.toLowerCase()
  return SENDABLE.some((extension) => lower.endsWith(extension))
}

/** Every file path in a project tree, relative to its root. */
function flatten(files: readonly ProjectFile[]): string[] {
  const paths: string[] = []

  const visit = (entries: readonly ProjectFile[]) => {
    for (const entry of entries) {
      if (entry.kind === 'directory') {
        visit(entry.children ?? [])
        continue
      }
      paths.push(entry.path)
    }
  }

  visit(files)
  return paths
}

/**
 * A buffer's absolute path as a project-relative one.
 *
 * Buffers hold absolute paths because that is what capabilities act on; the
 * service speaks project-relative. Null for a buffer that is not under this
 * project at all, which is possible and is not an error.
 */
function relativeTo(projectPath: string, absolute: string): string | null {
  const prefix = projectPath.endsWith('/') ? projectPath : `${projectPath}/`
  if (!absolute.startsWith(prefix)) return null
  const relative = absolute.slice(prefix.length)
  return relative === '' ? null : relative
}
