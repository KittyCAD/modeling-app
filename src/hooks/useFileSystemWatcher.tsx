import { isDesktop } from 'lib/isDesktop'
import { reportRejection } from 'lib/trap'
import { useEffect, useState, useRef } from 'react'

type Path = string

// Not having access to NodeJS functions has influenced the design a little.
// There is some indirection going on because we can only pass data between
// the NodeJS<->Browser boundary. The actual functions need to run on the
// NodeJS side. Because EventEmitters come bundled with their listener
// methods it complicates things because we can't just do
// watcher.addListener(() => { ... }).

export const useFileSystemWatcher = (
  callback: (eventType: string, path: Path) => Promise<void>,
  paths: Path[]
): void => {
  // Used to track this instance of useFileSystemWatcher.
  // Assign to ref so it doesn't change between renders.
  const key = useRef(Math.random().toString())

  const [output, setOutput] = useState<
    { eventType: string; path: string } | undefined
  >(undefined)

  // Used to track if paths list changes.
  const [pathsTracked, setPathsTracked] = useState<Path[]>([])

  useEffect(() => {
    if (!output) return
    callback(output.eventType, output.path).catch(reportRejection)
  }, [output])

  // On component teardown obliterate all watchers.
  useEffect(() => {
    // The hook is useless on web.
    if (!isDesktop()) return

    const cbWatcher = (eventType: string, path: string) => {
      setOutput({ eventType, path })
    }

    for (let path of pathsTracked) {
      // Because functions don't retain refs between NodeJS-Browser I need to
      // pass an identifying key so we can later remove it.
      // A way to think of the function call is:
      // "For this path, add a new handler with this key"
      // "There can be many keys (functions) per path"
      // Again if refs were preserved, we wouldn't need to do this. Keys
      // gives us uniqueness.
      window.electron.watchFileOn(path, key.current, cbWatcher)
    }

    return () => {
      for (let path of pathsTracked) {
        window.electron.watchFileOff(path, key.current)
      }
    }
  }, [pathsTracked])

  function difference<T>(l1: T[], l2: T[]): [T[], T[]] {
    return [
      l1.filter((x) => Boolean(!l2.find((x2) => x2 === x))),
      l1.filter((x) => Boolean(l2.find((x2) => x2 === x))),
    ]
  }

  const hasDiff = difference(paths, pathsTracked)[0].length !== 0

  // Removing 1 watcher at a time is only possible because in a filesystem,
  // a path is unique (there can never be two paths with the same name).
  // Otherwise we would have to obliterate() the whole list and reconstruct it.
  useEffect(() => {
    // The hook is useless on web.
    if (!isDesktop()) return

    if (!hasDiff) return

    const [, pathsRemaining] = difference(pathsTracked, paths)
    const [pathsAdded] = difference(paths, pathsTracked)
    setPathsTracked(pathsRemaining.concat(pathsAdded))
  }, [hasDiff])
}
