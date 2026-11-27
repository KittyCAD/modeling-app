import type { Project } from '@src/lib/projectSession/next/types'
import { computed } from '@preact/signals-core'
import type { Editor } from '@src/lib/editors/registry/contract'
import fsZds from '@src/lib/fs-zds'
import type {
  OpenProjectSession,
  ProjectSessionService,
  ProjectSourcesService,
} from '@src/lib/projectSession/next/contract'
import { isErr } from '@src/lib/trap'

/**
 * Captures project files with open-document text taking precedence over storage.
 * `capture` copies all open document text synchronously, then reads missing files
 * through the captured session's `files.readBytes`. Storage reads happen per file;
 * this is not an atomic snapshot of external filesystem changes.
 */
export function createProjectSources(
  getProjects: () => ProjectSessionService | undefined,
  getDocuments: () => readonly Pick<Editor, 'src' | 'contents'>[]
): ProjectSourcesService {
  // Metadata updates retain `contents`; this intermediate computed prevents a
  // title/default-file change from invalidating the execution source revision.
  const projectTree = computed(
    () => getProjects()?.currentSession.value?.project.value.contents
  )
  const encode = (text: string) => new TextEncoder().encode(text)
  // Compare newly opened text buffers with the last storage reads for this opening
  // and file tree. Capture still reads storage normally; this is not a read cache.
  // Keep text rather than retaining binary import payloads.
  const knownStoredText = new WeakMap<
    OpenProjectSession,
    {
      project: Project['contents']
      files: Map<string, string>
    }
  >()
  let previous:
    | {
        session: OpenProjectSession | undefined
        project: Project['contents'] | undefined
        documents: ReadonlyMap<string, string>
      }
    | undefined
  let version = Symbol('project sources')
  const revision = computed(() => {
    const session = getProjects()?.currentSession.value
    const project = projectTree.value
    const documents = new Map<string, string>()
    for (const document of getDocuments()) {
      const src = document.src.value
      if (!src) continue
      const path = fsZds.join(src)
      if (!documents.has(path)) documents.set(path, document.contents.value)
    }
    const known = session && knownStoredText.get(session)
    const stored = known?.project === project ? known?.files : undefined
    const last = previous
    const changed =
      !last ||
      last.session !== session ||
      last.project !== project ||
      [...documents].some(([path, text]) => {
        const before = last.documents.get(path)
        if (before !== undefined) return before !== text
        return stored?.get(path) !== text
      }) ||
      [...last.documents.keys()].some((path) => !documents.has(path))
    // Remember equal additions too, so later edits compare with their opening text.
    previous = { session, project, documents }
    if (changed) version = Symbol('project sources')
    return version
  })
  return {
    revision,
    capture: async ({
      document,
      unnamedPath,
      signal,
      include = () => true,
    }) => {
      const projects = getProjects()
      const session = projects?.currentSession.peek()
      const tree = session?.project.peek().contents
      // A new file tree or project opening invalidates a partially loaded input.
      // Already captured document text remains independent of subsequent typing.
      const cancelled = () =>
        signal.aborted ||
        (!!session &&
          (session.signal.aborted ||
            getProjects()?.currentSession.peek() !== session ||
            session.project.peek().contents !== tree))
      if (cancelled()) return new Error('Source capture was cancelled')
      const src = document.src || unnamedPath
      const working = new Map<string, Uint8Array>()
      for (const open of getDocuments()) {
        const path = open.src.peek()
        if (path && !working.has(fsZds.join(path)))
          working.set(fsZds.join(path), encode(open.contents.peek()))
      }
      working.set(fsZds.join(src), encode(document.contents))
      if (!session || !tree || !projects) return { src, files: working }
      const paths = projects.listFiles().map((file) => fsZds.join(file.path))
      if (document.src && !paths.includes(fsZds.join(document.src)))
        return new Error('The source file is no longer in the project')
      try {
        const files = new Map<string, Uint8Array>()
        const stored = new Map<string, string | undefined>()
        for (const path of paths) {
          if (path !== fsZds.join(src) && !(await include(path))) continue
          if (cancelled()) return new Error('Source capture was cancelled')
          let data = working.get(path)
          if (data === undefined) {
            data = await session.files.readBytes(
              fsZds.relative(tree.path, path)
            )
            try {
              stored.set(
                path,
                new TextDecoder('utf-8', {
                  fatal: true,
                  ignoreBOM: true,
                }).decode(data)
              )
            } catch {
              // Invalid UTF-8 cannot be reproduced by a text buffer.
              stored.set(path, undefined)
            }
          }
          if (cancelled()) return new Error('Source capture was cancelled')
          files.set(path, data.slice())
        }
        files.set(fsZds.join(src), encode(document.contents))
        if (stored.size) {
          const previous = knownStoredText.get(session)
          const known =
            previous?.project === tree
              ? previous.files
              : new Map<string, string>()
          for (const [path, text] of stored) {
            if (text === undefined) known.delete(path)
            else known.set(path, text)
          }
          knownStoredText.set(session, { project: tree, files: known })
        }
        return { src, files }
      } catch (cause) {
        return isErr(cause)
          ? cause
          : new Error('Unable to read project sources', { cause })
      }
    },
  }
}
