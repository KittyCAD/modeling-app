import { subscribeToSet } from '@src/lib/utils'
import { type ReadonlySignal, signal } from '@preact/signals-core'
import { ensureDirectory } from '@src/lib/fileSystem/ensureDirectory'
import { getRelativePathIfContained } from '@src/lib/paths'
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
  readonly batch?: <T>(
    root: string,
    run: (operations: FileOperationsRegistryService) => Promise<T>
  ) => Promise<T>
}

type WriteProgress = (progress: { written: number; total: number }) => void

async function writeProjectFiles(
  operations: FileOperationsRegistryService,
  files: readonly { path: string; contents: FileContents }[],
  overwrite: boolean,
  onProgress?: WriteProgress
) {
  const paths: string[] = []
  onProgress?.({ written: 0, total: files.length })
  for (const { path, contents } of files) {
    await ensureDirectory(operations, fsZds.dirname(path))
    if (overwrite) {
      await operations.writeFile(path, contents)
      paths.push(path)
    } else {
      const extension = fsZds.extname(path)
      paths.push(
        await operations.createUniqueFile(
          fsZds.dirname(path),
          { stem: fsZds.basename(path, extension), extension },
          contents
        )
      )
    }
    onProgress?.({ written: paths.length, total: files.length })
  }
  return paths
}

/** Project operations share one storage boundary and have no navigation effects. */
export function createProjectOperations(deps: ProjectOperationsDependencies) {
  const projects = signal<readonly Project[]>([])
  let listGeneration = 0
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
    projects: projects as ReadonlySignal<readonly Project[]>,
    pending,
    failure,
    subscribe: (listener: (change: FileOperationChange) => void) =>
      subscribeToSet(listeners, listener),
    notify,
    listProjects: (directory: string) =>
      run(async () => {
        const { readProjectsFromProjectDirectory } = await import(
          '@src/lib/projectLibraries/directoryScanner'
        )
        const generation = ++listGeneration
        const result = await readProjectsFromProjectDirectory({
          fileOperations: operations,
          projectDirectoryPath: directory,
          wasmInstancePromise: deps.wasm(),
        })
        if (generation === listGeneration) projects.value = result
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
    duplicateProject: (
      project: Project,
      title: string,
      editor?: { path: string; contents: string }
    ) =>
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
          currentFilePath: editor?.path,
          currentFileContents: editor?.contents,
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
    writeFiles: (
      root: string,
      files: readonly { path: string; contents: FileContents }[],
      options: {
        overwrite?: boolean
        onProgress?: WriteProgress
      } = {}
    ) => {
      const owned = files.map((file) => ({
        ...file,
        contents:
          typeof file.contents === 'string'
            ? file.contents
            : new Uint8Array(file.contents),
      }))
      return run(async () => {
        for (const file of owned) {
          if (!getRelativePathIfContained(root, fsZds.resolve(root, file.path)))
            return Promise.reject(
              new Error('File edit is outside its project.')
            )
        }
        const work = async (operations: FileOperationsRegistryService) => {
          const paths = await writeProjectFiles(
            operations,
            owned.map((file) => ({
              ...file,
              path: fsZds.resolve(root, file.path),
            })),
            options.overwrite ?? false,
            options.onProgress
          )
          if (paths.length) {
            const { ensureProjectTomlTitle } = await import('@src/lib/desktop')
            await ensureProjectTomlTitle({
              fileOperations: operations,
              projectPath: root,
              title: fsZds.basename(root),
              defaultFile: fsZds.relative(root, paths[0]),
            })
          }
          return paths
        }
        const paths = deps.batch
          ? await deps.batch(root, work)
          : await work(operations)
        notify(paths)
        return paths
      })
    },
    applyEdits: (
      root: string,
      edits: readonly ProjectFileEdit[],
      onProgress?: WriteProgress
    ) => {
      // Snapshot inputs before queuing or yielding to asynchronous work.
      const owned = edits.map((edit) => ({
        ...edit,
        contents:
          edit.contents instanceof Uint8Array
            ? new Uint8Array(edit.contents)
            : edit.contents,
      }))
      return run(async () => {
        const work = async (operations: FileOperationsRegistryService) => {
          for (const edit of owned) {
            const relative = getRelativePathIfContained(root, edit.path)
            if (relative === '') {
              return Promise.reject(
                new Error('File edit must target a file inside its project.')
              )
            }
            if (relative === undefined) {
              return Promise.reject(
                new Error('File edit is outside its project.')
              )
            }
          }
          const writes = owned.flatMap(({ path, contents }) =>
            contents === null ? [] : [{ path, contents }]
          )
          await writeProjectFiles(operations, writes, true, onProgress)
          // Delete only after all creates and writes have succeeded.
          for (const edit of owned) {
            if (edit.contents === null) await operations.remove(edit.path)
          }
        }
        if (deps.batch) await deps.batch(root, work)
        else await work(operations)
        notify(owned.map(({ path }) => path))
      })
    },
  }
}

export type ProjectOperationsService = ReturnType<
  typeof createProjectOperations
>
