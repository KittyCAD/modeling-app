import { useEffect } from 'react'
import { useStore } from '../useStore'
import { parse } from 'toml'
import {
  createDir,
  BaseDirectory,
  readDir,
  readTextFile,
} from '@tauri-apps/api/fs'

export const useTauriBoot = () => {
  const { defaultDir, setDefaultDir, setHomeMenuItems } = useStore((s) => ({
    defaultDir: s.defaultDir,
    setDefaultDir: s.setDefaultDir,
    setHomeMenuItems: s.setHomeMenuItems,
  }))
  useEffect(() => {
    const isTauri = (window as any).__TAURI__
    if (!isTauri) return
    const run = async () => {
      if (!defaultDir.base) {
        createDir('puffin-projects/example', {
          dir: BaseDirectory.Home,
          recursive: true,
        })
        setDefaultDir({
          base: BaseDirectory.Home,
          dir: 'puffin-projects',
        })
      } else {
        const directoryResult = await readDir(defaultDir.dir, {
          dir: defaultDir.base,
          recursive: true,
        })
        const puffinProjects = directoryResult.filter(
          (file) =>
            !file?.name?.startsWith('.') &&
            file?.children?.find((child) => child?.name === 'wax.toml')
        )

        const tomlFiles = await Promise.all(
          puffinProjects.map(async (file) => {
            const parsedToml = parse(
              await readTextFile(`${file.path}/wax.toml`, {
                dir: defaultDir.base,
              })
            )
            const mainPath = parsedToml?.package?.main
            const projectName = parsedToml?.package?.name
            return {
              file,
              mainPath,
              projectName,
            }
          })
        )
        setHomeMenuItems(
          tomlFiles.map(({ file, mainPath, projectName }) => ({
            name: projectName,
            path: mainPath ? `${file.path}/${mainPath}` : file.path,
          }))
        )
      }
    }
    run()
  }, [])
}
