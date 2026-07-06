import JSZip from 'jszip'
import toast from 'react-hot-toast'

import { browserSaveFile } from '@src/lib/browserSaveFile'
import {
  EXPORT_TOAST_MESSAGES,
  PROJECT_SETTINGS_FILE_NAME,
} from '@src/lib/constants'
import fsZds from '@src/lib/fs-zds'
import { toProjectRelativePath, toWebSafePath } from '@src/lib/paths'
import type { Project } from '@src/lib/project'
import { getProjectDisplayName } from '@src/lib/projectDisplayName'
import { sanitizeProjectName } from '@src/lib/projectName'
import { getProjectTomlContents } from '@src/lib/projectToml'
import { isErr } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { collectProjectFiles } from '@src/machines/systemIO/utils'

type ProjectZipFile = {
  relativePath: string
  data: Uint8Array
}

type ProjectZipEntry = ProjectZipFile

export async function exportProjectZip({
  project,
  currentFilePath,
  currentFileContents,
  wasmInstance,
}: {
  project: Project | undefined
  currentFilePath?: string | null
  currentFileContents?: string
  wasmInstance: ModuleType
}) {
  const toastId = toast.loading(EXPORT_TOAST_MESSAGES.START)
  const archive = await createProjectZipArchive({
    project,
    currentFilePath,
    currentFileContents,
    wasmInstance,
  })

  if (isErr(archive)) {
    toast.error(archive.message, { id: toastId })
    return
  }

  await browserSaveFile(archive.blob, archive.fileName, toastId)
}

export async function createProjectZipArchive({
  project,
  currentFilePath,
  currentFileContents,
  wasmInstance,
}: {
  project: Project | undefined
  currentFilePath?: string | null
  currentFileContents?: string
  wasmInstance: ModuleType
}): Promise<{ blob: Blob; fileName: string } | Error> {
  if (!project) {
    return new Error('You need an open project to download a project ZIP.')
  }

  const entries = await collectProjectZipEntries({
    project,
    currentFilePath,
    currentFileContents,
    wasmInstance,
  })
  if (isErr(entries)) {
    return entries
  }

  const zip = new JSZip()
  const archiveRoot = sanitizeProjectName(
    getProjectDisplayName(project),
    'project'
  )
  for (const entry of entries) {
    const archivePath = `${archiveRoot}/${entry.relativePath}`
    zip.file(archivePath, entry.data, { binary: true })
  }

  const blob = await zip.generateAsync({ type: 'blob' })
  return {
    blob,
    fileName: `${archiveRoot}.zip`,
  }
}

export async function collectProjectZipEntries({
  project,
  currentFilePath,
  currentFileContents,
  wasmInstance,
}: {
  project: Project
  currentFilePath?: string | null
  currentFileContents?: string
  wasmInstance: ModuleType
}): Promise<ProjectZipEntry[] | Error> {
  try {
    const selectedFilePath =
      currentFilePath && currentFileContents !== undefined
        ? currentFilePath
        : undefined
    const projectFiles = await collectProjectFiles({
      selectedFileContents: currentFileContents ?? '',
      selectedFilePath,
      fileNames: selectedFilePath
        ? {
            0: {
              type: 'Local',
              value: selectedFilePath,
              original_import_path: null,
            },
          }
        : {},
      projectContext: project,
      warnIfProjectExceeds64Mb: false,
      skipUnreadableFiles: false,
    })

    const entries: ProjectZipEntry[] = []
    let hasProjectSettingsFile = false
    let hasCurrentFile = false

    for (const projectFile of projectFiles) {
      const entry =
        projectFile.type === 'kcl'
          ? {
              relativePath: toWebSafePath(projectFile.relPath),
              data: new TextEncoder().encode(projectFile.fileContents),
            }
          : {
              relativePath: toWebSafePath(projectFile.relPath),
              data: new Uint8Array(await projectFile.data.arrayBuffer()),
            }
      if (!entry.relativePath) {
        continue
      }

      if (entry.relativePath === PROJECT_SETTINGS_FILE_NAME) {
        hasProjectSettingsFile = true
      }
      if (
        projectFile.type === 'kcl' &&
        projectFile.absPath === selectedFilePath
      ) {
        hasCurrentFile = true
      }

      entries.push(entry)
    }

    if (
      selectedFilePath &&
      currentFileContents !== undefined &&
      !hasCurrentFile &&
      selectedFilePath.startsWith(project.path + fsZds.sep)
    ) {
      entries.push({
        relativePath: toProjectRelativePath(project.path, selectedFilePath),
        data: new TextEncoder().encode(currentFileContents),
      })
    }

    if (!hasProjectSettingsFile) {
      const projectToml = await getProjectTomlContents({
        projectPath: project.path,
        defaultFilePath: project.default_file,
        defaultFileFallback: 'main.kcl',
        readExistingFile: false,
        wasmInstance,
      })
      if (isErr(projectToml)) {
        return projectToml
      }

      entries.push({
        relativePath: PROJECT_SETTINGS_FILE_NAME,
        data: new TextEncoder().encode(projectToml),
      })
    }

    if (entries.length === 0) {
      return new Error('This project does not have any files to download.')
    }

    return entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  } catch (error) {
    return new Error(
      `Failed to create project ZIP: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}
