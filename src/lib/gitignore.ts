import ignore, { type Ignore } from 'ignore'

import fsZds from '@src/lib/fs-zds'

export type GitignoreStackEntry = {
  /** Relative path from project root to the directory containing this .gitignore */
  directory: string
  matcher: Ignore
}

function toPosixPath(path: string): string {
  return path.replace(/\\/g, '/')
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

export async function readGitignoreStackEntry(
  directoryPath: string,
  projectRoot: string
): Promise<GitignoreStackEntry | null> {
  const gitignorePath = fsZds.join(directoryPath, '.gitignore')
  try {
    const content = await fsZds.readFile(gitignorePath, { encoding: 'utf-8' })
    const directory = toPosixPath(fsZds.relative(projectRoot, directoryPath))
    return {
      directory: directory === '.' ? '' : directory,
      matcher: ignore().add(content),
    }
  } catch {
    return null
  }
}

export async function createInitialGitignoreStack(
  projectRoot: string
): Promise<GitignoreStackEntry[]> {
  const entry = await readGitignoreStackEntry(projectRoot, projectRoot)
  return entry ? [entry] : []
}

export async function appendGitignoreForDirectory(
  stack: GitignoreStackEntry[],
  directoryPath: string,
  projectRoot: string
): Promise<GitignoreStackEntry[]> {
  const entry = await readGitignoreStackEntry(directoryPath, projectRoot)
  return entry ? [...stack, entry] : stack
}
