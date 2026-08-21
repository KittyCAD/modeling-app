import { isPathInGitWorkingCopy } from '@src/lib/gitWorkingCopy'
import { useEffect, useState } from 'react'

/**
 * Reports whether a path lives inside a git working copy. Pass `undefined` to
 * skip the check entirely, for example when the path is not on this computer.
 */
export function useIsGitWorkingCopy(path: string | undefined): boolean {
  const [isGitWorkingCopy, setIsGitWorkingCopy] = useState(false)

  useEffect(() => {
    if (!path) {
      setIsGitWorkingCopy(false)
      return
    }

    let cancelled = false

    async function checkPath(targetPath: string) {
      const result = await isPathInGitWorkingCopy(targetPath)
      if (!cancelled) {
        setIsGitWorkingCopy(result)
      }
    }

    void checkPath(path).catch((e) => {
      console.error('Failed to check for a git working copy', e)
    })

    return () => {
      cancelled = true
    }
  }, [path])

  return isGitWorkingCopy
}
