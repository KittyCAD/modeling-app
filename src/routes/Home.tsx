import { FormEvent, useEffect, useState } from 'react'
import Loading from '../components/Loading'
import { FileEntry, readDir, removeFile, renameFile } from '@tauri-apps/api/fs'
import {
  FILE_EXT,
  createNewFile,
  getNextProjectIndex,
  initializeProjectDirectory,
  interpolateProjectNameWithIndex,
  projectNameNeedsInterpolated,
} from '../lib/tauriFS'
import { ActionButton } from '../components/ActionButton'
import { faPlus } from '@fortawesome/free-solid-svg-icons'
import { useStore } from '../useStore'
import { toast } from 'react-hot-toast'
import FileCard from '../components/FileCard'

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
  }

  async function handleRenameFile(
    e: FormEvent<HTMLFormElement>,
    file: FileEntry
  ) {
    const { newFileName } = Object.fromEntries(
      new FormData(e.target as HTMLFormElement)
    )
    if (
      newFileName &&
      file.name &&
      newFileName !== file.name.replace(FILE_EXT, '')
    ) {
      const dir = file.path?.replace(file.name, '') || ''
      await renameFile(file.path, dir + newFileName + FILE_EXT).catch((err) => {
        console.error('Error renaming file:', err)
        toast.error('Error renaming file')
      })

      setFiles(
        Object.assign([
          ...files.map((f) =>
            f.name === file.name
              ? Object.assign(file, {
                  name: newFileName + FILE_EXT,
                  path: dir + newFileName + FILE_EXT,
                })
              : f
          ),
        ])
      )
      toast.success('File renamed')
    }
  }

  async function handleDeleteFile(file: FileEntry) {
    if (file.path) {
      await removeFile(file.path).catch((err) => {
        console.error('Error renaming file:', err)
        toast.error('Error renaming file')
      })

      setFiles([...files.filter((f) => f.name !== file.name)])
      toast.success('File deleted')
    }
  }

  return (
    <div className="my-24 max-w-5xl mx-auto">
      <h1 className="text-3xl text-bold">Home</h1>
      {isLoading ? (
        <Loading>Loading your files...</Loading>
      ) : (
        <>
          {files.length > 0 ? (
            <ul className="my-4 grid grid-cols-4 gap-4">
              {files.map((file) => (
                <FileCard
                  key={file.name}
                  file={file}
                  handleRenameFile={handleRenameFile}
                  handleDeleteFile={handleDeleteFile}
                />
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
