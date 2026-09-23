import { Dialog } from '@headlessui/react'
import { ActionButton } from '@src/components/ActionButton'
import { useApp } from '@src/lib/boot'
import { PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import { parseProjectZipArchive } from '@src/lib/downloadProject'
import { PATHS, safeEncodeForRouterPaths } from '@src/lib/paths'
import { getProjectDirectoryNameFromTitle } from '@src/lib/projectName'
import { getProjectTitleFromProjectTomlContents } from '@src/lib/projectTomlMetadata'
import { isErr } from '@src/lib/trap'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export function ImportProjectDialog({
  initialFile,
  initialLibraryId,
  onDismiss,
}: {
  initialFile?: File
  initialLibraryId?: string
  onDismiss: () => void
}) {
  const app = useApp()
  const navigate = useNavigate()
  const targets = app.getCreateProjectLibraryTargets()
  const [file, setFile] = useState(initialFile)
  const [libraryId, setLibraryId] = useState(
    targets.find(({ library }) => library.id === initialLibraryId)?.library
      .id ??
      targets[0]?.library.id ??
      ''
  )
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState<string>()
  const fileInput = useRef<HTMLInputElement>(null)
  const importInProgress = useRef(false)

  const importProject = async () => {
    if (!file || importInProgress.current) return
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setError('Choose a project ZIP file.')
      return
    }

    importInProgress.current = true
    setIsImporting(true)
    setError(undefined)
    try {
      const archive = await parseProjectZipArchive({
        archive: await file.arrayBuffer(),
        fileName: file.name,
      })
      if (isErr(archive)) {
        setError(archive.message)
        return
      }
      // Resolve the destination again after reading the archive. Never silently
      // fall back to a different library if the selected one disappeared.
      const target = app
        .getCreateProjectLibraryTargets()
        .find(({ library }) => library.id === libraryId)
      if (!target) {
        setError('Choose a writable project library.')
        return
      }
      const projectToml = archive.files.find(
        (entry) => entry.requestedFileName === PROJECT_SETTINGS_FILE_NAME
      )
      const title =
        (projectToml &&
          getProjectTitleFromProjectTomlContents(
            new TextDecoder().decode(projectToml.requestedData)
          )) ||
        archive.projectName
      const project = await target.createProject.run({
        library: target.library,
        requestedProjectName: getProjectDirectoryNameFromTitle(
          title,
          'imported-project'
        ),
        requestedProjectTitle: title,
        initialProject: {
          files: archive.files,
          entrypointFilePath: archive.entrypointFilePath,
        },
      })
      if (!project?.default_file) {
        setError('Unable to create the imported project.')
        return
      }
      onDismiss()
      void navigate(
        `${PATHS.FILE}/${safeEncodeForRouterPaths(project.default_file)}`
      )
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to import the project.'
      )
    } finally {
      importInProgress.current = false
      setIsImporting(false)
    }
  }

  return (
    <Dialog
      open={true}
      onClose={() => {
        if (!importInProgress.current) onDismiss()
      }}
      className="relative z-50"
    >
      <div className="fixed inset-0 grid bg-chalkboard-110/80 place-content-center p-4">
        <Dialog.Panel className="w-full max-w-lg rounded border border-chalkboard-40 bg-chalkboard-10 p-4 dark:border-chalkboard-70 dark:bg-chalkboard-100">
          <Dialog.Title as="h2" className="mb-2 text-2xl font-bold">
            Import project
          </Dialog.Title>
          <Dialog.Description className="mb-4">
            Create a new project from a Zoo Design Studio ZIP. You can also drop
            a ZIP onto the home page.
          </Dialog.Description>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void importProject()
            }}
          >
            <fieldset disabled={isImporting} className="flex flex-col gap-4">
              <div>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".zip,application/zip"
                  aria-label="Project ZIP"
                  className="hidden"
                  onChange={(event) => {
                    setFile(event.target.files?.[0])
                    setError(undefined)
                  }}
                />
                <ActionButton
                  Element="button"
                  type="button"
                  tabIndex={0}
                  className="py-2"
                  onClick={() => fileInput.current?.click()}
                >
                  Choose ZIP file
                </ActionButton>
                {file && <p className="mt-2 break-all text-sm">{file.name}</p>}
              </div>
              <label className="flex flex-col gap-1">
                Library
                <select
                  value={libraryId}
                  onChange={(event) => setLibraryId(event.target.value)}
                  className="rounded border border-chalkboard-40 bg-transparent p-2 dark:border-chalkboard-70"
                >
                  {targets.map(({ library }) => (
                    <option key={library.id} value={library.id}>
                      {library.title}
                    </option>
                  ))}
                </select>
              </label>
              {error && (
                <p role="alert" className="text-destroy-80">
                  {error}
                </p>
              )}
              {targets.length === 0 && (
                <p role="alert">
                  Add a writable project library to import a project.
                </p>
              )}
            </fieldset>
            <div className="mt-4 flex justify-end gap-2">
              <ActionButton
                Element="button"
                type="button"
                tabIndex={0}
                className="py-2"
                disabled={isImporting}
                onClick={onDismiss}
              >
                Cancel
              </ActionButton>
              <ActionButton
                Element="button"
                type="submit"
                tabIndex={0}
                className="py-2"
                disabled={
                  isImporting || !file || !libraryId || targets.length === 0
                }
              >
                {isImporting ? 'Importing...' : 'Import project'}
              </ActionButton>
            </div>
          </form>
        </Dialog.Panel>
      </div>
    </Dialog>
  )
}
