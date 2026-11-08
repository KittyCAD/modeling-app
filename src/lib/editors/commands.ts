import type { Command } from '@src/lib/commandTypes'
import type { EditorsService } from '@src/lib/editors/registry/contract'
import { loadProjectEditor } from '@src/lib/editors/loadProjectEditor'
import fsZds from '@src/lib/fs-zds'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import type { ProjectSessionService } from '@src/lib/projectSession/next/contract'
import { GLOBAL_COMMAND_SCOPES } from '@src/registry/contracts/commands'

export const NEW_EDITOR_COMMAND = {
  id: 'zds.editors.new',
  name: 'new-editor',
  groupId: 'editors',
} as const

export const OPEN_EDITOR_COMMAND = {
  id: 'zds.editors.open',
  name: 'open-editor',
  groupId: 'editors',
} as const

/** Load a file before publishing a ready-to-use editor; execution stays separate. */
export function createOpenEditorCommand(
  editors: EditorsService,
  getProjectSession: () => ProjectSessionService | undefined,
  getFileOperations: () => Pick<FileOperationsRegistryService, 'readFile'>
): Command {
  const options = () => {
    const session = getProjectSession()
    const project = session?.currentProject.value
    if (!session || !project) return []
    return session
      .listFiles()
      .map((file) => ({
        name: fsZds.relative(project.contents.path, file.path),
        value: file.path,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }
  return {
    ...OPEN_EDITOR_COMMAND,
    displayName: 'Open editor',
    description: 'Load a file from the current project into an editor.',
    icon: 'code',
    scopes: GLOBAL_COMMAND_SCOPES,
    needsReview: false,
    args: {
      src: {
        displayName: 'Source',
        description: 'Choose a file from the current project.',
        inputType: 'options',
        options,
        required: true,
      },
    },
    onSubmit: async (data?: { src?: unknown }) => {
      if (typeof data?.src !== 'string' || !data.src.trim()) {
        return new Error('An editor source is required')
      }
      const editor = await loadProjectEditor(
        data.src,
        editors,
        getProjectSession,
        getFileOperations,
        { reuseExisting: true }
      )
      if (editor instanceof Error) return editor
      editors.createView(editor)
      return editor
    },
  }
}
