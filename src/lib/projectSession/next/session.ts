import { batch, computed, signal, type Signal } from '@preact/signals-core'
import fsZds from '@src/lib/fs-zds'
import type { Project } from '@src/lib/projectSession/next/types'
import type { FileEntry } from '@src/lib/project'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import type {
  OpenProjectSession,
  ProjectSessionService,
} from '@src/lib/projectSession/next/contract'

/** Only this service can publish project changes; consumers receive a readonly signal. */
interface MutableProjectSession extends OpenProjectSession {
  readonly project: Signal<Project>
}

type ProjectStorage = Pick<
  FileOperationsRegistryService,
  'readFile' | 'writeFile'
>

/**
 * Bind file capabilities to the root and access grant captured for this opening.
 * Operations never re-read the global selection, so switching projects cannot retarget I/O.
 */
function createSession(
  project: Project,
  storage: () => ProjectStorage,
  lifetime: AbortSignal
): MutableProjectSession {
  const root = project.contents.path
  const canWrite = project.metadata.readWriteAccess

  function filePath(relativePath: string): string | Error {
    if (
      !relativePath ||
      relativePath.startsWith('/') ||
      relativePath.startsWith('\\') ||
      /^[a-zA-Z]:/.test(relativePath)
    )
      return new Error('Expected a project-relative file path')
    const path = fsZds.resolve(root, relativePath)
    const relative = fsZds.relative(root, path)
    if (
      !relative ||
      relative === '..' ||
      relative.startsWith(`..${fsZds.sep}`)
    ) {
      return new Error('File path must stay within its project')
    }
    return path
  }

  return {
    signal: lifetime,
    project: signal(project),
    files: {
      read: async (relativePath) => {
        const path = filePath(relativePath)
        if (path instanceof Error) return Promise.reject(path)
        const bytes = await storage().readFile(path)
        return new TextDecoder().decode(bytes)
      },
      write: async (relativePath, contents) => {
        if (!canWrite) return Promise.reject(new Error('Project is read-only'))
        const path = filePath(relativePath)
        if (path instanceof Error) return Promise.reject(path)
        await storage().writeFile(path, contents)
      },
    },
  }
}

/**
 * Select project data without acquiring editor resources or changing the legacy session.
 * Replacing or clearing the selection leaves captured sessions usable against their original root.
 * Storage is resolved lazily so registering the service performs no filesystem work.
 */
export function createProjectSessionService(
  storage: () => ProjectStorage
): ProjectSessionService {
  const currentSession = signal<MutableProjectSession | undefined>(undefined)
  let lifetime: AbortController | undefined
  const currentProject = computed(() => currentSession.value?.project.value)
  return {
    currentSession,
    currentProject,
    listFiles: () => {
      const files: FileEntry[] = []
      const visit = (entries: readonly FileEntry[]) => {
        for (const entry of entries) {
          if (entry.name === '.zoo') continue
          if (entry.children === null) files.push(entry)
          else visit(entry.children)
        }
      }
      visit(currentProject.value?.contents.children ?? [])
      return files
    },
    openProject: (project) => {
      const previous = lifetime
      const nextLifetime = new AbortController()
      const next = createSession(project, storage, nextLifetime.signal)
      batch(() => {
        lifetime = nextLifetime
        currentSession.value = next
        previous?.abort()
      })
      return next
    },
    updateMetadata: (session, metadata) => {
      const current = currentSession.peek()
      if (current !== session || current.signal.aborted) return
      const project = current.project.peek()
      current.project.value = {
        ...project,
        metadata: { ...project.metadata, ...metadata },
      }
    },
    closeProject: () => {
      const previous = lifetime
      batch(() => {
        lifetime = undefined
        currentSession.value = undefined
        previous?.abort()
      })
    },
  }
}
