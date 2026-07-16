import path from 'path'

export function getOPFSStorageRootPath(targetPath: string) {
  const resolvedTargetPath = path.resolve(targetPath)
  const resolvedCwd = path.resolve()
  return resolvedCwd === path.parse(resolvedCwd).root ||
    resolvedTargetPath === resolvedCwd ||
    resolvedTargetPath.startsWith(`${resolvedCwd}${path.sep}`)
    ? resolvedCwd
    : path.parse(resolvedTargetPath).root
}
