import { signal } from '@preact/signals-core'
import { ensureDirectory } from '@src/lib/fileSystem/ensureDirectory'
import fsZds from '@src/lib/fs-zds'
import type { Project } from '@src/lib/project'
import type { ProjectLibraryInitialProject } from '@src/lib/projectLibraries'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { FileContents } from '@src/lib/fileSystem/fileOperations'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'

export interface ProjectFileEdit {
  readonly path: string
  /** Null removes the path; bytes and strings create or replace a file. */
  readonly contents: FileContents | null
}

export interface FileOperationChange {
  readonly paths: readonly string[]
}

export interface CreateProjectOptions {
  readonly directory: string
  readonly name: string
  readonly title?: string
  readonly initialProject?: ProjectLibraryInitialProject
}

export interface ProjectOperationsDependencies {
  readonly operations: FileOperationsRegistryService
  readonly wasm: () => Promise<ModuleType>
  /** Own a bulk edit's persistence boundary, when supplied by a backend. */
  readonly batch?: <T>(root: string, run: () => Promise<T>) => Promise<T>
}

/** Project workflows share one storage boundary and have no navigation effects. */
export function createProjectOperations(deps: ProjectOperationsDependencies) {
  const projects = signal<readonly Project[]>([])
  const pending = signal(0)
  const failure = signal<unknown>(undefined)
  const listeners = new Set<(change: FileOperationChange) => void>()
  const run = async <T>(work: () => Promise<T>): Promise<T> => {
    pending.value += 1
    try {
      const result = await work()
      failure.value = undefined
      return result
    } catch (error) {
      failure.value = error
      return Promise.reject(error)
    } finally {
      pending.value -= 1
    }
  }
  const notify = (paths: readonly string[]) => {
    for (const listener of listeners) listener({ paths })
  }
  const { operations } = deps
  return {
    projects,
    pending,
    failure,
    subscribe: (listener: (change: FileOperationChange) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    notify,
    listProjects: (directory: string) =>
      run(async () => {
        const { readProjectsFromProjectDirectory } = await import(
          '@src/lib/projectLibraries/directoryScanner'
        )
        const result = await readProjectsFromProjectDirectory({
          fileOperations: operations,
          projectDirectoryPath: directory,
          wasmInstancePromise: deps.wasm(),
        })
        projects.value = result
        return result
      }),
    openProject: (path: string) =>
      run(async () => {
        const { getProjectInfo } = await import('@src/lib/desktop')
        return getProjectInfo(operations, path, await deps.wasm())
      }),
    createProject: (options: CreateProjectOptions) =>
      run(async () => {
        const { createProjectInLocalDirectory } = await import(
          '@src/lib/projectLibraries/operations'
        )
        const result = await createProjectInLocalDirectory({
          fileOperations: operations,
          projectDirectoryPath: options.directory,
          requestedProjectName: options.name,
          requestedProjectTitle: options.title ?? options.name,
          wasmInstancePromise: deps.wasm(),
          initialProject: options.initialProject,
        })
        notify([result.path])
        return result
      }),
    renameProject: (path: string, title: string) =>
      run(async () => {
        const { writeProjectTitleToProjectToml } = await import(
          '@src/lib/desktop'
        )
        await writeProjectTitleToProjectToml(operations, path, title)
        notify([path])
        return { path, title }
      }),
    duplicateProject: (project: Project, title: string) =>
      run(async () => {
        const { duplicateProjectInDirectory } = await import(
          '@src/lib/projectDuplication'
        )
        const result = await duplicateProjectInDirectory({
          fileOperations: operations,
          source: {
            path: project.path,
            directoryName: project.name,
            displayName: title,
          },
          projectDirectoryPath: fsZds.dirname(project.path),
          requestedProjectTitle: title,
          wasmInstance: await deps.wasm(),
        })
        const path = fsZds.join(fsZds.dirname(project.path), result.name)
        notify([path])
        return { ...result, path }
      }),
    deleteProject: (path: string) =>
      run(async () => {
        await operations.remove(path)
        notify([path])
      }),
    applyEdits: (root: string, edits: readonly ProjectFileEdit[]) => {
      // Snapshot inputs before queuing or yielding to asynchronous work.
      const owned = edits.map((edit) => ({
        ...edit,
        contents:
          edit.contents instanceof Uint8Array
            ? new Uint8Array(edit.contents)
            : edit.contents,
      }))
      return run(async () => {
        const work = async () => {
          for (const edit of owned) {
            const relative = fsZds.relative(root, edit.path)
            if (
              relative === '..' ||
              relative.startsWith(`..${fsZds.sep}`) ||
              fsZds.resolve(root, relative) !== fsZds.resolve(edit.path)
            ) {
              return Promise.reject(
                new Error('File edit is outside its project.')
              )
            }
          }
          for (const edit of owned) {
            if (edit.contents === null) continue
            await ensureDirectory(operations, fsZds.dirname(edit.path))
            await operations.writeFile(edit.path, edit.contents)
          }
          // Delete only after all creates and writes have succeeded.
          for (const edit of owned) {
            if (edit.contents === null) await operations.remove(edit.path)
          }
        }
        if (deps.batch) await deps.batch(root, work)
        else await work()
        notify(owned.map(({ path }) => path))
      })
    },
  }
}

export type ProjectOperationsService = ReturnType<
  typeof createProjectOperations
>
