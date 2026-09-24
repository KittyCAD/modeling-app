import type { LockedDirectoryOperations } from '@src/lib/fileSystem/fileOperations'
import {
  equalBytes,
  equalFiles,
  readProjectFiles,
  type ProjectFiles,
  type ProjectPaths,
} from '@src/lib/kclMigration/snapshot'

export class MigrationRecoveryError extends Error {
  constructor(
    readonly failures: readonly string[],
    cause: unknown
  ) {
    super(
      `Migration could not restore these files: ${failures.join(', ')}. Keep this dialog open and download the original project.`,
      { cause }
    )
  }
}

/** Caller owns the directory and cloud-sync locks until recovery has finished. */
export async function replaceMigrationFiles({
  files,
  paths,
  root,
  expected,
  replacement,
  isCurrent,
}: {
  files: LockedDirectoryOperations
  paths: ProjectPaths
  root: string
  expected: ProjectFiles
  replacement: ProjectFiles
  isCurrent: () => boolean
}): Promise<void> {
  const current = await readProjectFiles(files, paths, root)
  if (!isCurrent() || !equalFiles(current, expected)) {
    const changed = [
      ...new Set([...current.keys(), ...expected.keys()]),
    ].filter((name) => {
      const before = expected.get(name)
      const now = current.get(name)
      return !before || !now || !equalBytes(before, now)
    })
    return Promise.reject(
      new Error(
        `The project changed${changed.length ? ` (${changed.slice(0, 3).join(', ')})` : ''}. Capture and review a new migration before applying.`
      )
    )
  }
  if (
    expected.size !== replacement.size ||
    [...expected.keys()].some((name) => !replacement.has(name))
  ) {
    return Promise.reject(
      new Error('The migration must preserve the project file set.')
    )
  }
  const attempted: string[] = []
  try {
    for (const [name, before] of expected) {
      const after = replacement.get(name)
      if (!after)
        return await Promise.reject(
          new Error(`Missing migration file: ${name}`)
        )
      if (equalBytes(before, after)) continue
      if (
        !isCurrent() ||
        !equalBytes(await files.readFile(paths.join(root, name)), before)
      ) {
        return await Promise.reject(
          new Error(`The project changed while applying ${name}.`)
        )
      }
      attempted.push(name)
      await files.writeFile(paths.join(root, name), after)
    }
    if (
      !isCurrent() ||
      !equalFiles(await readProjectFiles(files, paths, root), replacement)
    ) {
      return await Promise.reject(
        new Error('The project changed while the migration was being applied.')
      )
    }
  } catch (error: unknown) {
    const failed: string[] = []
    for (const name of attempted.toReversed()) {
      const before = expected.get(name)
      const after = replacement.get(name)
      if (!before || !after) continue
      try {
        const current = await files.readFile(paths.join(root, name))
        if (equalBytes(current, before)) continue
        // An external writer is outside the app's lock. Never overwrite its edit.
        if (!equalBytes(current, after)) {
          failed.push(name)
          continue
        }
        await files.writeFile(paths.join(root, name), before)
      } catch {
        failed.push(name)
      }
    }
    if (failed.length)
      return Promise.reject(new MigrationRecoveryError(failed, error))
    return Promise.reject(error)
  }
}
