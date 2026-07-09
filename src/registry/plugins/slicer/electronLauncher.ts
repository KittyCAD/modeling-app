import fs from 'fs'
import { spawn } from 'node:child_process'
import path from 'path'
import type {
  ElectronPluginContext,
  PluginIpcChannel,
} from '@src/registry/pluginIpc'
import type { SlicerLaunchResult } from '@src/registry/plugins/slicer/types'

export type SlicerLauncherDefinition = {
  pluginId: string
  channel: PluginIpcChannel
  slicerName: string
  acceptedFileExtensions: readonly `.${string}`[]
  executablePaths: () => readonly string[]
  launchArgs?: (filePath: string) => readonly string[]
}

export function getChildDirectoryExecutableCandidates({
  parentDirectories,
  matches,
  executableRelativePath,
}: {
  parentDirectories: readonly (string | undefined)[]
  matches: (directoryName: string) => boolean
  executableRelativePath: readonly string[]
}) {
  const candidates: string[] = []

  for (const parentDirectory of parentDirectories) {
    if (!parentDirectory) {
      continue
    }

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(parentDirectory, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || !matches(entry.name)) {
        continue
      }

      candidates.push(
        path.join(parentDirectory, entry.name, ...executableRelativePath)
      )
    }
  }

  return candidates
}

export function getPathCandidatesFromEnvironment(
  executableNames: readonly string[]
) {
  return (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .flatMap((directory) =>
      executableNames.map((executableName) =>
        path.join(directory, executableName)
      )
    )
}

async function firstExistingPath(paths: readonly string[]) {
  for (const maybePath of paths) {
    try {
      await fs.promises.access(maybePath)
      return maybePath
    } catch {
      // Keep checking fallback install paths.
    }
  }
  return undefined
}

function openFileWithSlicer({
  definition,
  executablePath,
  filePath,
}: {
  definition: SlicerLauncherDefinition
  executablePath: string
  filePath: string
}): Promise<SlicerLaunchResult> {
  return new Promise((resolve) => {
    const child = spawn(
      executablePath,
      [...(definition.launchArgs?.(filePath) ?? [filePath])],
      {
        detached: true,
        stdio: 'ignore',
      }
    )

    child.once('error', (error) => {
      resolve({
        ok: false,
        error: `Failed to launch ${definition.slicerName}: ${error.message}`,
      })
    })
    child.once('spawn', () => {
      child.unref()
      resolve({ ok: true, executablePath })
    })
  })
}

export function registerSlicerLauncher(
  { handlePluginInvoke }: ElectronPluginContext,
  definition: SlicerLauncherDefinition
) {
  handlePluginInvoke(
    definition.pluginId,
    definition.channel,
    async (_event, filePath) => {
      if (
        process.platform !== 'darwin' &&
        process.platform !== 'win32' &&
        process.platform !== 'linux'
      ) {
        return {
          ok: false,
          error: `${definition.slicerName} export is only supported on macOS, Windows, and Linux.`,
        }
      }

      if (typeof filePath !== 'string') {
        return {
          ok: false,
          error: `${definition.slicerName} export expects a file path.`,
        }
      }

      const acceptedFileExtensions = definition.acceptedFileExtensions.map(
        (extension) => extension.toLowerCase()
      )
      if (
        !acceptedFileExtensions.includes(path.extname(filePath).toLowerCase())
      ) {
        return {
          ok: false,
          error: `${definition.slicerName} export expects one of ${acceptedFileExtensions.join(', ')}: ${filePath}`,
        }
      }

      try {
        await fs.promises.access(filePath)
      } catch {
        return {
          ok: false,
          error: `Exported file was not found: ${filePath}`,
        }
      }

      const executablePath = await firstExistingPath(
        definition.executablePaths()
      )
      if (!executablePath) {
        return {
          ok: false,
          error: `${definition.slicerName} was not found in the usual install locations. Exported file: ${filePath}`,
        }
      }

      return openFileWithSlicer({ definition, executablePath, filePath })
    }
  )
}
