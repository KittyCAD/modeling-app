import path from 'path'

export function runningOnLinux() {
  return process.platform === 'linux'
}

export function runningOnMac() {
  return process.platform === 'darwin'
}

export function runningOnWindows() {
  return process.platform === 'win32'
}

export function executorInputPath(fileName: string): string {
  return path.join('rust', 'kcl-lib', 'e2e', 'executor', 'inputs', fileName)
}

export function testsInputPath(fileName: string): string {
  return path.join('rust', 'kcl-lib', 'tests', 'inputs', fileName)
}

export function kclSamplesPath(fileName: string): string {
  return path.join('public', 'kcl-samples', fileName)
}
