import os from 'node:os'
import path from 'path'
import type { ElectronPluginContext } from '@src/registry/pluginIpc'
import { CURA_SLICER_OPEN_STL_CHANNEL } from '@src/registry/plugins/curaSlicer/ipc'
import { SLICER_PLUGIN_ID } from '@src/registry/plugins/slicer/constants'
import {
  getChildDirectoryExecutableCandidates,
  getPathCandidatesFromEnvironment,
  registerSlicerLauncher,
} from '@src/registry/plugins/slicer/electronLauncher'

function getCuraSlicerCandidatePaths() {
  if (process.platform === 'darwin') {
    const applicationPaths = [
      ['UltiMaker Cura.app', 'Contents', 'MacOS', 'UltiMaker-Cura'],
      ['UltiMaker Cura.app', 'Contents', 'MacOS', 'Cura'],
      ['Ultimaker Cura.app', 'Contents', 'MacOS', 'Ultimaker Cura'],
      ['Ultimaker Cura.app', 'Contents', 'MacOS', 'Cura'],
    ]

    return [
      ...applicationPaths.flatMap((relativePath) => [
        path.join('/Applications', ...relativePath),
        path.join(os.homedir(), 'Applications', ...relativePath),
      ]),
      ...getPathCandidatesFromEnvironment([
        'UltiMaker-Cura',
        'Ultimaker-Cura',
        'ultimaker-cura',
        'cura',
      ]),
    ]
  }

  if (process.platform === 'win32') {
    const installParents = [
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.LOCALAPPDATA &&
        path.join(process.env.LOCALAPPDATA, 'Programs'),
    ]
    const isCuraInstallDirectory = (directoryName: string) =>
      /^(UltiMaker|Ultimaker) Cura\b/i.test(directoryName) ||
      /^Cura\b/i.test(directoryName)

    return [
      ...getChildDirectoryExecutableCandidates({
        parentDirectories: installParents,
        matches: isCuraInstallDirectory,
        executableRelativePath: ['UltiMaker-Cura.exe'],
      }),
      ...getChildDirectoryExecutableCandidates({
        parentDirectories: installParents,
        matches: isCuraInstallDirectory,
        executableRelativePath: ['Ultimaker-Cura.exe'],
      }),
      ...getChildDirectoryExecutableCandidates({
        parentDirectories: installParents,
        matches: isCuraInstallDirectory,
        executableRelativePath: ['Cura.exe'],
      }),
      ...getPathCandidatesFromEnvironment([
        'UltiMaker-Cura.exe',
        'Ultimaker-Cura.exe',
        'ultimaker-cura.exe',
        'cura.exe',
      ]),
    ]
  }

  if (process.platform === 'linux') {
    return [
      '/usr/bin/ultimaker-cura',
      '/usr/local/bin/ultimaker-cura',
      '/usr/bin/cura',
      '/usr/local/bin/cura',
      '/snap/bin/cura-slicer',
      '/snap/bin/ultimaker-cura',
      ...getPathCandidatesFromEnvironment([
        'UltiMaker-Cura',
        'Ultimaker-Cura',
        'ultimaker-cura',
        'cura',
        'cura-slicer',
      ]),
    ]
  }

  return []
}

export function register(context: ElectronPluginContext) {
  registerSlicerLauncher(context, {
    pluginId: SLICER_PLUGIN_ID,
    channel: CURA_SLICER_OPEN_STL_CHANNEL,
    slicerName: 'UltiMaker Cura',
    acceptedFileExtensions: ['.stl'],
    executablePaths: getCuraSlicerCandidatePaths,
  })
}
