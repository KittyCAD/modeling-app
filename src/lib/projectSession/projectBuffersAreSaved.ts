import { hasPendingActiveTextFileWrite } from '@src/lib/activeTextFile'
import type { ZDSProject } from '@src/lib/projectSession'

export const projectBuffersAreSaved = (project: ZDSProject) =>
  !hasPendingActiveTextFileWrite(project.path) &&
  [...project.editors.values()].every(
    (editor) =>
      !editor.hasUnsavedLocalChanges() &&
      !editor.writingPromise.peek() &&
      !project.files.some(
        (file) => editor.getPendingFileCode(file.path) !== undefined
      )
  )
