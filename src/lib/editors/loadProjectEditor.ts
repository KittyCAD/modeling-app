import type { Editor, EditorsService } from '@src/lib/editors/registry/contract'
import { isErr } from '@src/lib/trap'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import type { ProjectSessionService } from '@src/lib/projectSession/next/contract'

/** Load before synchronous editor creation, retaining ownership of the selected project. */
export async function loadProjectEditor(
  src: string,
  editors: EditorsService,
  getProjectSession: () => ProjectSessionService | undefined,
  getFileOperations: () => Pick<FileOperationsRegistryService, 'readFile'>,
  {
    signal,
    reuseExisting = false,
  }: { signal?: AbortSignal; reuseExisting?: boolean } = {}
): Promise<Editor | Error> {
  if (signal?.aborted) return new Error('Opening the editor was cancelled')
  const projects = getProjectSession()
  const session = projects?.currentSession.value
  if (!session || !projects.listFiles().some((file) => file.path === src)) {
    return new Error('The selected file is no longer available')
  }
  const existing = () =>
    reuseExisting
      ? editors.editors.peek().find((editor) => editor.src.peek() === src)
      : undefined
  const opened = existing()
  if (opened) return opened
  try {
    const bytes = await getFileOperations().readFile(src)
    if (signal?.aborted) return new Error('Opening the editor was cancelled')
    if (getProjectSession()?.currentSession.value !== session) {
      return new Error('The project changed before the file finished loading')
    }
    if (!projects.listFiles().some((file) => file.path === src)) {
      return new Error('The selected file is no longer available')
    }
    return (
      existing() ?? editors.openEditor(src, new TextDecoder().decode(bytes))
    )
  } catch (error) {
    return isErr(error)
      ? error
      : new Error('Unable to load the file', { cause: error })
  }
}
