import fs from 'fs'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'path'
import {
  type OpenStlInPrusaSlicerResult,
  PRUSA_SLICER_OPEN_STL_CHANNEL,
} from '@src/registry/plugins/prusaSlicer/ipc'

const PRUSA_SLICER_PLUGIN_ID = 'prusa-slicer'

type ElectronPluginContext = {
  handlePluginInvoke: (
    pluginId: string,
    channel: typeof PRUSA_SLICER_OPEN_STL_CHANNEL,
    handler: (event: unknown, ...args: unknown[]) => unknown
  ) => void
}

async function firstExistingPath(paths: string[]) {
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

function getPathCandidatesFromEnvironment(executableNames: string[]) {
  return (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .flatMap((directory) =>
      executableNames.map((executableName) =>
        path.join(directory, executableName)
      )
    )
}

function getPrusaSlicerCandidatePaths() {
  if (process.platform === 'darwin') {
    return [
      '/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer',
      path.join(
        os.homedir(),
        'Applications',
        'PrusaSlicer.app',
        'Contents',
        'MacOS',
        'PrusaSlicer'
      ),
      '/Applications/Original Prusa Drivers/PrusaSlicer.app/Contents/MacOS/PrusaSlicer',
      path.join(
        os.homedir(),
        'Applications',
        'Original Prusa Drivers',
        'PrusaSlicer.app',
        'Contents',
        'MacOS',
        'PrusaSlicer'
      ),
      ...getPathCandidatesFromEnvironment(['PrusaSlicer', 'prusa-slicer']),
    ]
  }

  if (process.platform === 'win32') {
    return [
      process.env.ProgramFiles &&
        path.join(
          process.env.ProgramFiles,
          'Prusa3D',
          'PrusaSlicer',
          'prusa-slicer.exe'
        ),
      process.env['ProgramFiles(x86)'] &&
        path.join(
          process.env['ProgramFiles(x86)'],
          'Prusa3D',
          'PrusaSlicer',
          'prusa-slicer.exe'
        ),
      process.env.LOCALAPPDATA &&
        path.join(
          process.env.LOCALAPPDATA,
          'Programs',
          'Prusa3D',
          'PrusaSlicer',
          'prusa-slicer.exe'
        ),
      process.env.LOCALAPPDATA &&
        path.join(
          process.env.LOCALAPPDATA,
          'Programs',
          'PrusaSlicer',
          'prusa-slicer.exe'
        ),
      process.env.ProgramFiles &&
        path.join(process.env.ProgramFiles, 'PrusaSlicer', 'prusa-slicer.exe'),
      process.env['ProgramFiles(x86)'] &&
        path.join(
          process.env['ProgramFiles(x86)'],
          'PrusaSlicer',
          'prusa-slicer.exe'
        ),
      ...getPathCandidatesFromEnvironment(['prusa-slicer.exe']),
    ].filter((candidate): candidate is string => Boolean(candidate))
  }

  if (process.platform === 'linux') {
    return [
      '/usr/bin/prusa-slicer',
      '/usr/local/bin/prusa-slicer',
      '/snap/bin/prusa-slicer',
      ...getPathCandidatesFromEnvironment([
        'prusa-slicer',
        'PrusaSlicer',
        'prusaslicer',
      ]),
    ]
  }

  return []
}

function openStlWithPrusaSlicer(
  executablePath: string,
  stlPath: string
): Promise<OpenStlInPrusaSlicerResult> {
  return new Promise((resolve) => {
    const child = spawn(executablePath, [stlPath], {
      detached: true,
      stdio: 'ignore',
    })

    child.once('error', (error) => {
      resolve({
        ok: false,
        error: `Failed to launch PrusaSlicer: ${error.message}`,
      })
    })
    child.once('spawn', () => {
      child.unref()
      resolve({ ok: true, executablePath })
    })
  })
}

export function register({ handlePluginInvoke }: ElectronPluginContext) {
  handlePluginInvoke(
    PRUSA_SLICER_PLUGIN_ID,
    PRUSA_SLICER_OPEN_STL_CHANNEL,
    async (_event, stlPath: unknown) => {
      if (
        process.platform !== 'darwin' &&
        process.platform !== 'win32' &&
        process.platform !== 'linux'
      ) {
        return {
          ok: false,
          error:
            'Export to PrusaSlicer is only supported on macOS, Windows, and Linux.',
        }
      }

      if (typeof stlPath !== 'string') {
        return {
          ok: false,
          error: 'PrusaSlicer export expects an STL file path.',
        }
      }

      if (path.extname(stlPath).toLowerCase() !== '.stl') {
        return {
          ok: false,
          error: `PrusaSlicer export expects an STL file: ${stlPath}`,
        }
      }

      try {
        await fs.promises.access(stlPath)
      } catch {
        return {
          ok: false,
          error: `Exported STL was not found: ${stlPath}`,
        }
      }

      const executablePath = await firstExistingPath(
        getPrusaSlicerCandidatePaths()
      )
      if (!executablePath) {
        return {
          ok: false,
          error: `PrusaSlicer was not found in the usual install locations. Exported STL: ${stlPath}`,
        }
      }

      return openStlWithPrusaSlicer(executablePath, stlPath)
    }
  )
}
