import { useEffect, useRef, useState } from 'react'
import Loading from '../components/Loading'
import { FileEntry, readDir } from '@tauri-apps/api/fs'
import {
  createNewFile,
  getNextProjectIndex,
  initializeProjectDirectory,
  interpolateProjectNameWithIndex,
  projectNameNeedsInterpolated,
} from '../lib/tauriFS'
import { ActionButton } from '../components/ActionButton'
import { faPlus, faPlusCircle } from '@fortawesome/free-solid-svg-icons'
import { useStore } from '../useStore'

// This route only opens in the Tauri desktop context for now,
// as defined in Router.tsx, so we can use the Tauri APIs and types.
const Home = () => {
  const [isLoading, setIsLoading] = useState(true)
  const [files, setFiles] = useState<FileEntry[]>([])
  const { defaultDir, defaultProjectName } = useStore((s) => ({
    defaultDir: s.defaultDir,
    defaultProjectName: s.defaultProjectName,
  }))

  useEffect(() => {
    initializeProjectDirectory().then(async (projectDir) => {
      const readFiles = await readDir(projectDir.dir)

      console.log(readFiles)
      setFiles(readFiles)
      setIsLoading(false)
    })
  }, [setFiles, setIsLoading])

  async function handleNewFile() {
    let filename = defaultProjectName
    if (projectNameNeedsInterpolated(filename)) {
      const nextIndex = await getNextProjectIndex(defaultProjectName, files)
      filename = interpolateProjectNameWithIndex(defaultProjectName, nextIndex)
    }

    const newFile = await createNewFile(defaultDir.dir + '/' + filename)
    setFiles([...files, newFile])

    console.log({ newFile })
  }

  return (
    <div className="my-24 max-w-5xl mx-auto">
      <h1 className="text-3xl text-bold">Home</h1>
      {isLoading ? (
        <Loading>Loading your files...</Loading>
      ) : (
        <>
          {files.length > 0 ? (
            <ul>
              {files.map((file) => (
                <li key={file.name}>{file.name}</li>
              ))}
            </ul>
          ) : (
            <p>No files found, ready to make your first one?</p>
          )}
          <ActionButton onClick={handleNewFile} icon={{ icon: faPlus }}>
            New file
          </ActionButton>
        </>
      )}
    </div>
  )
}

export default Home
