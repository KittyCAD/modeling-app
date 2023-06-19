import { invoke } from '@tauri-apps/api/tauri'
import { open } from '@tauri-apps/api/dialog'
import { useStore } from '../useStore'

export const OpenFileButton = () => {
  const { setCode } = useStore((s) => ({
    setCode: s.setCode,
  }))
  const handleClick = async () => {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [
        {
          name: 'CAD',
          extensions: ['toml'],
        },
      ],
    })
    if (Array.isArray(selected)) {
      // User selected multiple files
      // We should not get here, since multiple is false.
    } else if (selected === null) {
      // User cancelled the selection
      // Do nothing.
    } else {
      // User selected a single file
      // We want to invoke our command to read the file.
      const json: string = await invoke('read_toml', { path: selected })
      const packageDetails = JSON.parse(json).package
      if (packageDetails.main) {
        const absPath = [
          ...selected.split('/').slice(0, -1),
          packageDetails.main,
        ].join('/')
        const file: string = await invoke('read_txt_file', { path: absPath })
        setCode(file)
      }
    }
  }
  return <button onClick={() => handleClick()}>Open File</button>
}
