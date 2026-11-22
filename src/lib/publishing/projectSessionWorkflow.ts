import { Transaction } from '@codemirror/state'
import type { CloudStorageService } from '@src/lib/cloudProjects/registry/contract'
import { withProjectTitleInArchiveFiles } from '@src/lib/cloudProjects/runtime/archive'
import type { ProjectArchiveFile } from '@src/lib/cloudProjects/runtime/types'
import { PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import type { EditorsService } from '@src/lib/editors/registry/contract'
import { getContainedRelativePath } from '@src/lib/fileSystem/pathContainment'
import fsZds from '@src/lib/fs-zds'
import { buildMinimalDocumentChange } from '@src/lib/minimalDocumentChange'
import { isOffline } from '@src/lib/networkStatus'
import type {
  OpenProjectSession,
  ProjectSessionService,
} from '@src/lib/projectSession/next/contract'
import { collectProjectFilesForUpload } from '@src/lib/projectSession/projectFiles'
import { setProjectDefaultFileInProjectTomlContents } from '@src/lib/projectTomlMetadata'
import { createPublicationWorkflow } from '@src/lib/publishing/workflow'
import type { EditorSave } from '@src/lib/save/registry/contract'
import { isErr } from '@src/lib/trap'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'

/** Publication retains one opening and its buffers, never a mutable current-project lookup. */
export function createProjectSessionPublicationWorkflow({
  session,
  editors,
  saving,
  cloud,
  fileOperations,
  token,
  isCurrent,
  updateMetadata,
  openCloudProject,
  validate,
}: {
  session: OpenProjectSession
  editors: Pick<EditorsService, 'editors'>
  saving: Pick<EditorSave, 'save' | 'adopt' | 'state'>
  cloud: Pick<
    CloudStorageService,
    | 'pathFor'
    | 'createProject'
    | 'renameProject'
    | 'publishProject'
    | 'getPublicationDetails'
  >
  fileOperations: FileOperationsRegistryService
  token: string
  isCurrent: () => boolean
  updateMetadata: ProjectSessionService['updateMetadata']
  openCloudProject: (id: string) => void | Promise<void>
  validate: (files: ProjectArchiveFile[]) => Promise<Error | undefined>
}) {
  const project = session.project.peek()
  const root = project.contents.path
  const id = project.storage?.projectId
  const contained = (src: string) =>
    getContainedRelativePath(
      { relative: fsZds.relative, sep: fsZds.sep },
      root,
      src
    )
  const current = () => !session.signal.aborted && isCurrent()
  const sourceEditors = () =>
    editors.editors.peek().filter((editor) => {
      const src = editor.src.peek()
      return src ? Boolean(contained(src)) : editor.contents.peek().length > 0
    })
  return createPublicationWorkflow({
    loadDetails: async () =>
      id && token && current()
        ? cloud.getPublicationDetails({
            token,
            projectId: id,
            fallbackTitle: project.metadata.title,
          })
        : null,
    prepare: async (submission) => {
      if (!current()) return new Error('The project is no longer open.')
      if (!token) return new Error('Sign in before publishing a project.')
      if (isOffline())
        return new Error('Connect to the internet before publishing.')
      if (!session.project.peek().metadata.readWriteAccess)
        return new Error('This project is read-only.')
      if (id && cloud.pathFor(id) !== root)
        return new Error('The cloud project does not match this opening.')
      const title = submission.title.trim()
      if (!title) return new Error('Enter a project title before publishing.')
      const buffers = sourceEditors().map((editor) => ({
        editor,
        src: editor.src.peek(),
        contents: editor.contents.peek(),
      }))
      if (buffers.some((buffer) => !buffer.src))
        return new Error(
          'Save unnamed buffers to a project file before publishing.'
        )
      // Capture dirty documents together; clean buffers must not overwrite external file changes.
      const saved = await Promise.all(
        buffers
          .filter(({ editor }) => {
            const state = saving.state(editor).peek()
            return state.dirty || state.saving
          })
          .map(({ editor }) => saving.save(editor))
      )
      const failure = saved.find(isErr)
      if (failure) return failure
      const ready = () => {
        const open = sourceEditors()
        return (
          current() &&
          session.project.peek().metadata.readWriteAccess &&
          open.length === buffers.length &&
          buffers.every(({ editor, src, contents }) => {
            const state = saving.state(editor).peek()
            return (
              !state.dirty &&
              !state.saving &&
              !editor.signal.aborted &&
              open.includes(editor) &&
              editor.src.peek() === src &&
              editor.contents.peek() === contents
            )
          })
        )
      }
      if (!ready())
        return new Error(
          'The project changed while preparing publication. Try again.'
        )
      const files = await collectProjectFilesForUpload({
        fileOperations,
        projectRoot: root,
      })
      if (
        !files.some((file) => file.relativePath === PROJECT_SETTINGS_FILE_NAME)
      ) {
        const hasConfig = await fileOperations.exists(
          fsZds.join(root, PROJECT_SETTINGS_FILE_NAME)
        )
        let config = hasConfig
          ? await session.files.read(PROJECT_SETTINGS_FILE_NAME)
          : ''
        if (!hasConfig && project.metadata.defaultFile)
          config = setProjectDefaultFileInProjectTomlContents(
            config,
            project.metadata.defaultFile
          )
        files.push({
          relativePath: PROJECT_SETTINGS_FILE_NAME,
          data: new TextEncoder().encode(config),
        })
      }
      const invalid = await validate(files)
      if (invalid) return invalid
      if (!ready())
        return new Error(
          'The project changed while preparing publication. Try again.'
        )
      let targetId = id
      if (targetId) {
        await cloud.renameProject(targetId, title)
        if (current()) {
          updateMetadata(session, { title })
          const config = await session.files.read(PROJECT_SETTINGS_FILE_NAME)
          if (current())
            for (const { editor, src, contents } of buffers) {
              if (
                !src ||
                contained(src) !== PROJECT_SETTINGS_FILE_NAME ||
                editor.signal.aborted ||
                editor.src.peek() !== src
              )
                continue
              if (editor.contents.peek() === contents) {
                const changes = buildMinimalDocumentChange(contents, config)
                if (changes)
                  editor.dispatch({
                    changes,
                    annotations: Transaction.addToHistory.of(false),
                  })
              }
              const adopted = saving.adopt(editor, config)
              if (isErr(adopted)) return adopted
            }
        }
      } else {
        const created = await cloud.createProject(
          title,
          withProjectTitleInArchiveFiles(files, title)
        )
        targetId = created.id
        if (current()) await openCloudProject(targetId)
      }
      const capturedId = targetId
      return {
        publish: () =>
          cloud.publishProject({
            projectId: capturedId,
            token,
            submission,
            validate,
          }),
        loadDetails: (projectId: string) =>
          cloud.getPublicationDetails({
            token,
            projectId,
            fallbackTitle: title,
          }),
      }
    },
  })
}
