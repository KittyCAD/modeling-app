import { Button, TextField } from '@kittycad/ui-kit'
import { useSignal } from '@preact/signals'
import type { ProjectLibrarySettingsDetailsProps } from '@src/contracts/projectLibraries'

/** Folder addressing contributed by the directory library type. */
export function DirectoryLibrarySettingsDetails({
  library,
  readOnly,
  update,
  chooseDirectory,
}: ProjectLibrarySettingsDetailsProps) {
  const draftPath = useSignal(library.path)

  const commitPath = () => {
    const path = draftPath.value.trim()
    if (path && path !== library.path) update({ path })
    else draftPath.value = library.path
  }

  const choose = async () => {
    if (!chooseDirectory) return
    const path = await chooseDirectory({
      title: 'Choose a project library folder',
      defaultPath: library.path,
    })
    if (path) update({ path })
  }

  return (
    <div class="zds-library-settings__folder">
      <TextField
        label="Folder"
        value={draftPath}
        disabled={readOnly || Boolean(chooseDirectory)}
        onValueInput={(path) => {
          draftPath.value = path
        }}
        onBlur={commitPath}
        onSubmit={commitPath}
      />
      {chooseDirectory ? (
        <Button
          icon="folderOpen"
          label="Choose folder"
          disabled={readOnly}
          onClick={() => void choose()}
        />
      ) : null}
    </div>
  )
}
