import os from 'node:os'
import path from 'path'
import type { ElectronPluginContext } from '@src/registry/pluginIpc'
import { PRUSA_SLICER_OPEN_STL_CHANNEL } from '@src/registry/plugins/prusaSlicer/ipc'
import { SLICER_PLUGIN_ID } from '@src/registry/plugins/slicer/constants'
import {
  getPathCandidatesFromEnvironment,
  registerSlicerLauncher,
} from '@src/registry/plugins/slicer/electronLauncher'

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

export function register(context: ElectronPluginContext) {
  registerSlicerLauncher(context, {
    pluginId: SLICER_PLUGIN_ID,
    channel: PRUSA_SLICER_OPEN_STL_CHANNEL,
    slicerName: 'PrusaSlicer',
    acceptedFileExtensions: ['.stl'],
    executablePaths: getPrusaSlicerCandidatePaths,
  })
}
