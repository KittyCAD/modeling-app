import { Compartment, EditorState, StateEffect } from '@codemirror/state'
import { effect } from '@preact/signals-core'
import { getKclLanguageVersion } from '@src/lang/kclLanguageVersion'
import type { ZDSProject } from '@src/lib/projectSession'
import { File } from '@src/lib/projectSession/file'
import type { App } from '@src/lib/app'
import { cloudSyncService } from '@src/lib/cloudSync/registry/contract'
import fsZds from '@src/lib/fs-zds'
import { replaceMigrationFiles } from '@src/lib/kclMigration/apply'
import { MIGRATION_TARGET } from '@src/lib/kclMigration/protocol'
import { zookeeperEditPatchHistoryEvent } from '@src/lib/zookeeper/editorPlugin'
import { isErr, reportRejection } from '@src/lib/trap'
import type { MigrationProject } from '@src/lib/kclMigration/controller'
import {
  equalFiles,
  equalBytes,
  readProjectFiles,
  withEditorBuffers,
  type ProjectFiles,
} from '@src/lib/kclMigration/snapshot'

/** Observe the entrypoint's current source, including unsaved edits and closed files. */
export function watchMigrationSource(
  app: App,
  project: ZDSProject,
  onChange: (isKcl2: boolean) => void
): () => void {
  return effect(() => {
    const entrypoint = project.projectIORefSignal.value.default_file
    const activeEditor = project.executingEditor.value
    const editor =
      activeEditor?.path === entrypoint
        ? activeEditor
        : project.findEditor(entrypoint)?.[1]
    const code = editor?.codeSignal.value
    const file = new File(entrypoint)
    let revision = 0
    const update = async () => {
      const current = ++revision
      onChange(false)
      try {
        const source =
          code ??
          new TextDecoder('utf-8', { fatal: true }).decode(
            await app.fileOperations.readFile(entrypoint)
          )
        const wasm = await app.wasmPromise
        if (current === revision)
          onChange(getKclLanguageVersion(source, wasm) === '2.0')
      } catch {
        if (current === revision) onChange(false)
      }
    }
    if (code === undefined) {
      file.onWatchEvent.push(() => void update())
      file.watch()
    }
    void update()
    return () => {
      revision++
      file.unwatch()
    }
  })
}

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
      if (
        getKclLanguageVersion(
          new TextDecoder('utf-8', { fatal: true }).decode(source),
          wasm
        ) !== '2.0'
      ) {
        return Promise.reject(
          new Error('Migration requires an explicit KCL 2.0 project.')
        )
      }
      const target = getKclLanguageVersion(
        `@settings(kclVersion = "${MIGRATION_TARGET}")\nx = 1`,
        wasm
      )
      if (target !== MIGRATION_TARGET) {
        return Promise.reject(
          new Error('Update Zoo Design Studio to a version supporting KCL 3.')
        )
      }
      if (!isCurrent() || !equalFiles(files, await currentFiles())) {
        return Promise.reject(
          new Error('The project changed during capture. Try again.')
        )
      }
      return { projectId: id, entrypoint, files }
    },
    apply: async (expected, replacement, onReplay) => {
      if (
        !isCurrent() ||
        project.projectIORefSignal.value.cloudConflict ||
        !currentBuffersMatch(expected)
      ) {
        return Promise.reject(
          new Error(
            'The project changed during migration. Start a new migration to include those changes.'
          )
        )
      }
      const historyEditor = project.executingEditor.value
      if (!historyEditor)
        return Promise.reject(
          new Error('Open a KCL file before applying the migration.')
        )
      const historyPath = historyEditor.path
      const decoder = new TextDecoder('utf-8', { fatal: true })
      const snapshotFiles = [...expected].flatMap(([relativePath, before]) => {
        const after = replacement.get(relativePath)
        return after && !equalBytes(before, after)
          ? [
              {
                relativePath,
                absolutePath: fsZds.join(root, relativePath),
                previousContent: decoder.decode(before),
                nextContent: decoder.decode(after),
              },
            ]
          : []
      })
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
      const historyState = historyEditor.captureEditorHistoryState()
      historyEditor.zookeeperHistoryRecordingInProgress = true
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
        await cloud.withLocalProjectMutation(async () => {
          const stillCurrent = () =>
            isCurrent() &&
            historyEditor.path === historyPath &&
            project.executingEditor.value === historyEditor &&
            currentBuffersMatch(expected)
          await replaceMigrationFiles({
            files: app.fileOperations,
            paths,
            root,
            expected,
            replacement,
            isCurrent: stillCurrent,
          })
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
          if (snapshotFiles.length > 0) {
            const event = zookeeperEditPatchHistoryEvent({
              projectPath: root,
              activeFilePath: historyEditor.path,
              patch: {
                run_id: crypto.randomUUID(),
                changed_files: snapshotFiles.map((file) => ({
                  path: file.relativePath,
                  status: 'modified',
                })),
              },
              snapshotFiles,
              onReplay,
            })
            const activeFile = snapshotFiles.find(
              (file) => file.absolutePath === historyEditor.path
            )
            if (activeFile) {
              historyEditor.restoreEditorHistoryState(historyState)
              historyEditor.addGlobalHistoryEventWithCodeChange(
                event,
                activeFile.nextContent,
                activeFile.previousContent
              )
            } else historyEditor.addGlobalHistoryEvent(event)
          }
        })
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
          return 'Project files were updated, but the view could not refresh. Re-run the project. Undo is available.'
      } finally {
        historyEditor.zookeeperHistoryRecordingInProgress = false
        for (const { editor, compartment } of locks) {
          if (isCurrent())
            editor.editorView.dispatch({ effects: compartment.reconfigure([]) })
        }
      }
    },
  }
}
