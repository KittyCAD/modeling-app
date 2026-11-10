import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'

/** Returns an empty string for the root itself, or undefined for an outside path. */
export function getContainedRelativePath(
  paths: Pick<IZooDesignStudioFS, 'relative' | 'sep'>,
  root: string,
  target: string
): string | undefined {
  const relative = paths.relative(root, target)
  if (
    relative === '..' ||
    relative.startsWith(`..${paths.sep}`) ||
    relative.startsWith('/') ||
    relative.startsWith('\\') ||
    /^[a-z]:/i.test(relative)
  ) {
    return undefined
  }
  return relative
}
