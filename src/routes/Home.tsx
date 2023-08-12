import { FormEvent, useEffect, useState } from 'react'
import Loading from '../components/Loading'
import {
  FileEntry,
  readDir,
  renameFile,
} from '@tauri-apps/api/fs'
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

  return (
    <div className="my-24 max-w-5xl mx-auto">
      <h1 className="text-3xl text-bold">Home</h1>
      {isLoading ? (
        <Loading>Loading your files...</Loading>
      ) : (
        <>
          {files.length > 0 ? (
            <ul className="my-4">
              {files.map((file) => (
                <FileCard
                  key={file.name}
                  file={file}
                  handleRenameFile={handleRenameFile}
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

function FileCard({
  file,
  handleRenameFile,
  ...props
}: {
  file: FileEntry
  handleRenameFile: (
    e: FormEvent<HTMLFormElement>,
    f: FileEntry
  ) => Promise<void>
}) {
  const [isEditing, setIsEditing] = useState(false)

  function handleSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    handleRenameFile(e, file).then(() => setIsEditing(false))
  }

  return (
    <li {...props} className="px-2 py-1">
      {isEditing ? (
        <form onSubmit={handleSave}>
          <input
            className="dark:bg-chalkboard-80 dark:border-chalkboard-40"
            type="text"
            id="newFileName"
            name="newFileName"
            autoCorrect="off"
            autoCapitalize="off"
            defaultValue={file.name?.replace(FILE_EXT, '')}
          />
          <button type="submit">Save</button>
        </form>
      ) : (
        <>
          <span>{file.name?.replace(FILE_EXT, '')}</span>
          <button onClick={() => setIsEditing(true)}>Edit</button>
        </>
      )}
    </li>
  )
}

export default Home
