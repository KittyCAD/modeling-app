import type { Editor } from '@src/lib/editors/registry/contract'
import type { ExecutorRunContext } from '@src/lib/executors/registry/contract'
import fsZds from '@src/lib/fs-zds'
import { isErr } from '@src/lib/trap'
import type { ProjectSessionService } from '@src/lib/projectSession/next/contract'

/** Capture a project's KCL modules and unsaved editor snapshots before asynchronous reads. */
export async function loadKclProjectSources(
  contents: string,
  { editor, src, signal }: ExecutorRunContext,
  projects: ProjectSessionService | undefined,
  editors: readonly Editor[]
): Promise<string | Map<string, string> | Error> {
  const session = projects?.currentSession.peek()
  if (!projects || !session) return contents
  const root = session.project.peek().contents.path
  const files = projects.listFiles()
  if (!files.some((file) => file.path === src)) {
    return new Error('The executed file is no longer in the project')
  }
  const snapshots = new Map<string, string>()
  for (const opened of editors) {
    const path = opened.src.peek()
    if (!path) continue
    // Duplicate editors remain independent; the bound editor always wins below.
    if (opened !== editor && !snapshots.has(path)) {
      snapshots.set(path, opened.view.state.doc.toString())
    }
  }
  snapshots.set(src, contents)
  const sources = new Map<string, string>()
  try {
    for (const file of files) {
      if (signal.aborted || session.signal.aborted) {
        return new Error('KCL execution was cancelled')
      }
      // The SDK worker encodes all map values as UTF-8; binary asset imports
      // require a separate SDK file-reader API rather than decoding arbitrary files.
      if (fsZds.extname(file.path).toLowerCase() !== '.kcl') continue
      const source =
        snapshots.get(file.path) ??
        (await session.files.read(fsZds.relative(root, file.path)))
      if (signal.aborted || session.signal.aborted) {
        return new Error('KCL execution was cancelled')
      }
      sources.set(file.path, source)
    }
    return sources
  } catch (cause) {
    return isErr(cause)
      ? cause
      : new Error('Unable to read KCL project files', { cause })
  }
}
