import { Compartment, EditorState, StateEffect } from '@codemirror/state'
import type { ZDSProject } from '@src/lang/KclManager'
import { kclSettings } from '@src/lang/wasm'
import type { App } from '@src/lib/app'
import { cloudSyncService } from '@src/lib/cloudSync/registry/contract'
import fsZds from '@src/lib/fs-zds'
import { replaceMigrationFiles } from '@src/lib/kclMigration/apply'
import { isErr, reportRejection } from '@src/lib/trap'
import type { MigrationProject } from '@src/lib/kclMigration/controller'
import {
  equalFiles,
  readProjectFiles,
  withEditorBuffers,
  type ProjectFiles,
} from '@src/lib/kclMigration/snapshot'

/** Bind snapshots and writes to the same project object, including after navigation. */
export function migrationProject(
  app: App,
  project: ZDSProject
): MigrationProject {
  const root = project.path
  const token = app.auth.token.value
  const paths = {
    join: (...parts: string[]) => fsZds.join(...parts),
    relative: (from: string, to: string) => fsZds.relative(from, to),
    resolve: (...parts: string[]) => fsZds.resolve(...parts),
    extname: (path: string) => fsZds.extname(path),
  }
  const isCurrent = () =>
    app.project === project &&
    project.path === root &&
    app.auth.token.value === token
  const buffers = () =>
    new Map(
      [...project.editors.values()].map((editor) => [
        fsZds.relative(root, editor.path).replaceAll('\\', '/'),
        editor.code,
      ])
    )
  const currentFiles = async () => {
    const files = await readProjectFiles(app.fileOperations, paths, root)
    const snapshot = withEditorBuffers(files, buffers())
    return isErr(snapshot) ? Promise.reject(snapshot) : snapshot
  }
  const currentBuffersMatch = (expected: ProjectFiles) => {
    const overlay = withEditorBuffers(expected, buffers())
    return !isErr(overlay) && equalFiles(expected, overlay)
  }

  return {
    isCurrent,
    capture: async () => {
      const info = project.projectIORefSignal.value
      if (!isCurrent() || !info.readWriteAccess)
        return Promise.reject(new Error('Open a writable project to migrate.'))
      if (info.cloudConflict)
        return Promise.reject(
          new Error('Resolve the cloud sync conflict before migrating.')
        )
      const id = info.cloudProjectId
        ? `cloud:${info.cloudProjectId}`
        : info.projectId
          ? `local:${info.projectId}`
          : undefined
      if (!id)
        return Promise.reject(
          new Error(
            'Reopen this project to establish its saved project identity before migrating.'
          )
        )
      const files = await currentFiles()
      const entrypoint = fsZds
        .relative(root, info.default_file)
        .replaceAll('\\', '/')
      const source = files.get(entrypoint)
      if (!source)
        return Promise.reject(new Error('The project entrypoint is missing.'))
      const editor = project.executingEditor.value
      if (!editor)
        return Promise.reject(new Error('Open a KCL file before migrating.'))
      const wasm = await editor.wasmInstancePromise
      const settings = kclSettings(
        new TextDecoder('utf-8', { fatal: true }).decode(source),
        wasm
      )
      if (isErr(settings) || settings?.kclVersion !== '2.0') {
        return Promise.reject(
          new Error('Migration requires an explicit KCL 2.0 project.')
        )
      }
      const preview = kclSettings(
        '@settings(kclVersion = "3.0-preview")\nx = 1',
        wasm
      )
      if (isErr(preview) || preview?.kclVersion !== '3.0-preview') {
        return Promise.reject(
          new Error(
            'Update Zoo Design Studio to a version supporting KCL 3 preview.'
          )
        )
      }
      if (!isCurrent() || !equalFiles(files, await currentFiles())) {
        return Promise.reject(
          new Error('The project changed during capture. Try again.')
        )
      }
      return { projectId: id, entrypoint, files }
    },
    apply: async (expected, replacement) => {
      if (
        !isCurrent() ||
        project.projectIORefSignal.value.cloudConflict ||
        !currentBuffersMatch(expected)
      ) {
        return Promise.reject(
          new Error(
            'The project changed. Review a new migration before applying.'
          )
        )
      }
      const editors = [...project.editors.values()]
      const locks = editors.map((editor) => {
        const compartment = new Compartment()
        editor.editorView.dispatch({
          effects: StateEffect.appendConfig.of(
            compartment.of(EditorState.readOnly.of(true))
          ),
        })
        return { editor, compartment }
      })
      let refreshFailed = false
      try {
        for (const editor of editors) {
          if (!(await editor.flushWriteToFile()))
            return Promise.reject(
              new Error(
                'Save conflicts must be resolved before applying the migration.'
              )
            )
        }
        const cloud = app.registry.get(cloudSyncService)
        await cloud.withLocalProjectMutation(() =>
          app.fileOperations.withDirectoryLock(root, async (files) => {
            const stillCurrent = () =>
              isCurrent() && currentBuffersMatch(expected)
            await replaceMigrationFiles({
              files,
              paths,
              root,
              expected,
              replacement,
              isCurrent: stillCurrent,
            })
            // Synchronize buffers before releasing the lock so queued old saves see a new document version.
            for (const editor of editors) {
              const contents = replacement.get(
                fsZds.relative(root, editor.path).replaceAll('\\', '/')
              )
              if (contents) {
                try {
                  editor.synchronizeCurrentEditorAfterDirectGlobalReplay({
                    filePath: editor.path,
                    nextContent: new TextDecoder().decode(contents),
                  })
                } catch (error: unknown) {
                  refreshFailed = true
                  reportRejection(error)
                }
              }
            }
          })
        )
        try {
          if (isCurrent()) {
            await project.syncReplayedFilesToRust(
              [...replacement]
                .filter(([path]) => path.endsWith('.kcl'))
                .map(([path, contents]) => ({
                  absolutePath: fsZds.join(root, path),
                  nextContent: new TextDecoder().decode(contents),
                }))
            )
            if (isCurrent()) await project.executingEditor.value?.executeCode()
          }
        } catch (error: unknown) {
          reportRejection(error)
          refreshFailed = true
        }
        if (refreshFailed)
          return 'Project files were updated, but the view could not refresh. Re-run the project. Undo Migration is still available.'
      } finally {
        for (const { editor, compartment } of locks) {
          if (isCurrent())
            editor.editorView.dispatch({ effects: compartment.reconfigure([]) })
        }
      }
    },
  }
}
