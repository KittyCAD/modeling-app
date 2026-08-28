import type { FileSystem } from '@src/contracts/fileSystem'
import type { ProjectSession } from '@src/contracts/projectSession'
import { joinPath } from '@src/lib/paths'
import type { ProjectLibraryRealization } from '@src/lib/projectLibraries'

/** The file a project starts in when it names none of its own. */
const FALLBACK_FILE = 'main.kcl'

/**
 * Open the file a project starts in.
 *
 * The realization's own default first, then `main.kcl`, then nothing — and
 * nothing is a supported state rather than a failure. A project with neither is
 * a project you land in empty, which the editor already handles as a
 * destination.
 *
 * Existence is asked before opening rather than opening and catching, because a
 * failed read is noisy in a way a missing file should not be: on desktop the main
 * process logs a rejected handler before the renderer can catch it, which is how
 * a project with no `main.kcl` would report an error for behaving normally.
 */
export async function openDefaultFile(
  session: ProjectSession,
  realization: ProjectLibraryRealization,
  fileSystem: FileSystem
): Promise<string | null> {
  const candidates = [...new Set([realization.defaultFile, FALLBACK_FILE])]

  for (const candidate of candidates) {
    if (!candidate) continue

    const absolute = joinPath(realization.path, candidate)
    if (!(await fileSystem.exists(absolute))) continue

    try {
      await session.openFile(candidate)
      return candidate
    } catch (caught) {
      // Present but unreadable is worth saying: it is not the same as absent,
      // and silence would look like the project simply had no default.
      console.warn(`project: could not open ${candidate}`, caught)
    }
  }

  return null
}
