import { isDesktop } from 'lib/isDesktop'
import { useEffect, useState, useRef } from 'react'

type Path = string

// Not having access to NodeJS functions has influenced the design a little.
// There is some indirection going on because we can only pass data between
// the NodeJS<->Browser boundary. The actual functions need to run on the
// NodeJS side. Because EventEmitters come bundled with their listener
// methods it complicates things because we can't just do
// watcher.addListener(() => { ... }).

export const useFileSystemWatcher = (
  callback: (path: Path) => any | Promise<any>,
  dependencyArray: Path[]
): void => {
  // Track a ref to the callback. This is how we get the callback updated
  // across the NodeJS<->Browser boundary.
  const callbackRef = useRef<{ fn: (path: Path) => void }>({
    fn: (_path) => {},
  })

  useEffect(() => {
    callbackRef.current.fn = callback
  }, [callback])

  // Used to track if dependencyArrray changes.
  const [dependencyArrayTracked, setDependencyArrayTracked] = useState<Path[]>(
    []
  )

  // On component teardown obliterate all watchers.
  useEffect(() => {
    // The hook is useless on web.
    if (!isDesktop()) return

    return () => {
      for (let path of dependencyArray) {
        window.electron.watchFileOff(path)
      }
    }
  }, [])

  function difference<T>(l1: T[], l2: T[]): [T[], T[]] {
    return [
      l1.filter((x) => Boolean(!l2.find((x2) => x2 === x))),
      l1.filter((x) => Boolean(l2.find((x2) => x2 === x))),
    ]
  }

  const hasDiff =
    difference(dependencyArray, dependencyArrayTracked)[0].length !== 0

  // Removing 1 watcher at a time is only possible because in a filesystem,
  // a path is unique (there can never be two paths with the same name).
  // Otherwise we would have to obliterate() the whole list and reconstruct it.
  useEffect(() => {
    // The hook is useless on web.
    if (!isDesktop()) return

    if (!hasDiff) return

    const [pathsRemoved, pathsRemaining] = difference(
      dependencyArrayTracked,
      dependencyArray
    )
    for (let path of pathsRemoved) {
      window.electron.watchFileOff(path)
    }
    const [pathsAdded] = difference(dependencyArray, dependencyArrayTracked)
    for (let path of pathsAdded) {
      window.electron.watchFileOn(path, (_eventType: string, path: Path) =>
        callbackRef.current.fn(path)
      )
    }
    setDependencyArrayTracked(pathsRemaining.concat(pathsAdded))
  }, [hasDiff])
}
