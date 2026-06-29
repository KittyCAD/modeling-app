import ignore, { type Ignore } from 'ignore'

import { webSafePathSplit } from '@src/lib/pathUtils'

export type GitignoreStackEntry = {
  /** Relative path from project root to the directory containing this .gitignore */
  directory: string
  matcher: Ignore
}

export type GitignoreFs = {
  join: (...strs: string[]) => string
  relative: (...strs: string[]) => string
  readFile: (src: string, options: { encoding: 'utf-8' }) => Promise<string>
}

export type GitignoreFileEntry = {
  relativePath: string
  contents: string
}

function toPosixPath(path: string): string {
  return path.replace(/\\/g, '/')
}

function dirname(path: string): string {
  const normalizedPath = toPosixPath(path)
  const lastSlashIndex = normalizedPath.lastIndexOf('/')
  return lastSlashIndex === -1 ? '' : normalizedPath.slice(0, lastSlashIndex)
}

function basename(path: string): string {
  const normalizedPath = toPosixPath(path)
  const lastSlashIndex = normalizedPath.lastIndexOf('/')
  return lastSlashIndex === -1
    ? normalizedPath
    : normalizedPath.slice(lastSlashIndex + 1)
}

export function isPathIgnoredByGitignore(
  stack: GitignoreStackEntry[],
  pathRelativeToProjectRoot: string,
  isDirectory: boolean
): boolean {
  const normalizedPath = toPosixPath(pathRelativeToProjectRoot)

  for (const { directory, matcher } of stack) {
    if (directory) {
      if (normalizedPath === directory) {
        if (matcher.ignores('') || matcher.ignores('.')) {
          return true
        }
        if (isDirectory && matcher.ignores(`${directory}/`)) {
          return true
        }
        continue
      }
      if (!normalizedPath.startsWith(`${directory}/`)) {
        continue
      }
    }

    const pathFromGitignoreDir = directory
      ? normalizedPath.slice(directory.length + 1)
      : normalizedPath

    if (!pathFromGitignoreDir) {
      continue
    }

    if (matcher.ignores(pathFromGitignoreDir)) {
      return true
    }
    if (isDirectory && matcher.ignores(`${pathFromGitignoreDir}/`)) {
      return true
    }
  }

  return false
}

async function getDefaultFsZds() {
  const { default: fsZds } = await import('@src/lib/fs-zds')
  return fsZds
}

export function createGitignoreStackFromFiles(
  files: GitignoreFileEntry[]
): GitignoreStackEntry[] {
  return files
    .filter((file) => basename(file.relativePath) === '.gitignore')
    .map((file) => ({
      directory: dirname(file.relativePath),
      contents: file.contents,
    }))
    .toSorted((left, right) => {
      const leftDepth = left.directory
        ? webSafePathSplit(left.directory).length
        : 0
      const rightDepth = right.directory
        ? webSafePathSplit(right.directory).length
        : 0
      return (
        leftDepth - rightDepth || left.directory.localeCompare(right.directory)
      )
    })
    .map(({ directory, contents }) => ({
      directory,
      matcher: ignore().add(contents),
    }))
}

export async function readGitignoreStackEntryWithFs(
  fs: GitignoreFs,
  directoryPath: string,
  projectRoot: string
): Promise<GitignoreStackEntry | null> {
  const gitignorePath = fs.join(directoryPath, '.gitignore')
  try {
    const content = await fs.readFile(gitignorePath, { encoding: 'utf-8' })
    const directory = toPosixPath(fs.relative(projectRoot, directoryPath))
    return {
      directory: directory === '.' ? '' : directory,
      matcher: ignore().add(content),
    }
  } catch {
    return null
  }
}

export async function readGitignoreStackEntry(
  directoryPath: string,
  projectRoot: string
): Promise<GitignoreStackEntry | null> {
  return readGitignoreStackEntryWithFs(
    await getDefaultFsZds(),
    directoryPath,
    projectRoot
  )
}

export async function createInitialGitignoreStackWithFs(
  fs: GitignoreFs,
  projectRoot: string
): Promise<GitignoreStackEntry[]> {
  const entry = await readGitignoreStackEntryWithFs(
    fs,
    projectRoot,
    projectRoot
  )
  return entry ? [entry] : []
}

export async function createInitialGitignoreStack(
  projectRoot: string
): Promise<GitignoreStackEntry[]> {
  return createInitialGitignoreStackWithFs(await getDefaultFsZds(), projectRoot)
}

export async function appendGitignoreForDirectoryWithFs(
  fs: GitignoreFs,
  stack: GitignoreStackEntry[],
  directoryPath: string,
  projectRoot: string
): Promise<GitignoreStackEntry[]> {
  const entry = await readGitignoreStackEntryWithFs(
    fs,
    directoryPath,
    projectRoot
  )
  return entry ? [...stack, entry] : stack
}

export async function appendGitignoreForDirectory(
  stack: GitignoreStackEntry[],
  directoryPath: string,
  projectRoot: string
): Promise<GitignoreStackEntry[]> {
  return appendGitignoreForDirectoryWithFs(
    await getDefaultFsZds(),
    stack,
    directoryPath,
    projectRoot
  )
}
