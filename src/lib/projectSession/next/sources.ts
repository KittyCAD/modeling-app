import { computed } from '@preact/signals-core'
import type { Editor } from '@src/lib/editors/registry/contract'
import fsZds from '@src/lib/fs-zds'
import type {
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
  const revision = computed(() => ({
    project: projectTree.value,
    documents: getDocuments().map((document) => ({
      src: document.src.value,
      contents: document.contents.value,
    })),
  }))
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
      const encode = (text: string) => new TextEncoder().encode(text)
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
        for (const path of paths) {
          if (path !== fsZds.join(src) && !(await include(path))) continue
          if (cancelled()) return new Error('Source capture was cancelled')
          const data =
            working.get(path) ??
            (await session.files.readBytes(fsZds.relative(tree.path, path)))
          if (cancelled()) return new Error('Source capture was cancelled')
          files.set(path, data.slice())
        }
        files.set(fsZds.join(src), encode(document.contents))
        return { src, files }
      } catch (cause) {
        return isErr(cause)
          ? cause
          : new Error('Unable to read project sources', { cause })
      }
    },
  }
}
