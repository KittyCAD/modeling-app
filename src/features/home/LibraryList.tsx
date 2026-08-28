import { Button, Icon, TextField } from '@kittycad/ui-kit'
import { useComputed, useSignal } from '@preact/signals'
import { useService } from '@src/app/context'
import { authService } from '@src/contracts/auth'
import { fileSystemService } from '@src/contracts/fileSystem'
import { projectLibrariesService } from '@src/contracts/projectLibraries'
import { runtimeService } from '@src/contracts/runtime'
import { libraryIcon } from '@src/features/home/libraryIcon'
import { basename, joinPath, toDirectoryName } from '@src/lib/paths'
import type { ProjectLibrary } from '@src/lib/projectLibraries'
import './home.css'

interface LibraryListProps {
  onSelect: (library: ProjectLibrary) => void
}

/**
 * The library index.
 *
 * Shown only when there is more than one library — with a single library the
 * extra click buys nothing, so Home goes straight to its projects. Each row
 * carries its type's own description, so what a library *is* comes from the type
 * rather than from wording baked into Home.
 */
export function LibraryList({ onSelect }: LibraryListProps) {
  const libraries = useService(projectLibrariesService)

  const rows = useComputed(() =>
    libraries.libraries.value.map((library) => ({
      library,
      type: libraries.type(library.type),
      count: libraries.realizationsFor(library.id).length,
      removable: libraries.canRemoveLibrary(library.id),
    }))
  )

  return (
    <ul class="zds-library-list">
      {rows.value.map(({ library, type, count, removable }) => (
        <li class="zds-library-list__item" key={library.id}>
          <button
            type="button"
            class="zds-library-row"
            onClick={() => onSelect(library)}
          >
            <span class="zds-library-row__mark">
              <Icon name={libraryIcon(library, type)} />
            </span>
            <span class="zds-library-row__body">
              <span class="zds-library-row__title">{library.title}</span>
              <span class="zds-library-row__description">
                {type?.description ?? 'This library type is not installed.'}
              </span>
              <span class="zds-library-row__path zds-value">
                {library.path}
              </span>
            </span>
            <span class="zds-library-row__count">
              <span class="zds-label">Projects</span>
              <span class="zds-value zds-numeric">{count}</span>
            </span>
            <Icon name="chevronRight" class="zds-library-row__chevron" />
          </button>
          {removable ? (
            <div class="zds-library-row__actions">
              <Button
                variant="ghost"
                size="small"
                iconOnly
                icon="close"
                label={`Remove ${library.title}`}
                onClick={() => libraries.removeLibrary(library.id)}
              />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

/**
 * Add a library.
 *
 * Two shapes, because the platforms genuinely differ. On desktop, choosing the
 * folder *is* how access to it is granted, so the OS picker is the whole
 * interaction. In a browser there is one storage root and no picker, so a
 * library is a named folder inside it and the name has to be asked for.
 */
export function AddLibraryControl() {
  const libraries = useService(projectLibrariesService)
  const fileSystem = useService(fileSystemService)
  const runtime = useService(runtimeService)
  const auth = useService(authService)
  const naming = useSignal(false)
  const draftName = useSignal('')

  const type = useComputed(() =>
    Array.from(libraries.types.value.values()).find((candidate) => {
      if (
        candidate.newLibrarySetting === undefined ||
        candidate.userCreatable === false
      )
        return false
      const maximum = candidate.maximumInstances?.[runtime.info.value.target]
      return (
        maximum === undefined ||
        libraries.libraries.value.filter(
          (library) => library.type === candidate.type
        ).length < maximum
      )
    })
  )

  if (!type.value) return null

  const chooseDirectory = fileSystem.chooseDirectory?.bind(fileSystem)

  const addAtPath = (path: string, title: string) => {
    const base = type.value?.newLibrarySetting?.({
      defaultRoot: fileSystem.defaultRoot.value,
      defaultCloudRoot: fileSystem.defaultCloudRoot.value,
      authStatus: auth.status.value,
      isAuthenticated: auth.status.value === 'signedIn',
      ...runtime.info.value,
    })
    if (!base) return
    libraries.addLibrary({ ...base, path, title })
  }

  if (chooseDirectory) {
    return (
      <Button
        icon="plus"
        label="Add library"
        onClick={() => {
          void chooseDirectory({
            title: 'Choose a folder for projects',
            defaultPath: fileSystem.defaultRoot.value,
          }).then((chosen) => {
            if (chosen) addAtPath(chosen, basename(chosen) || 'Projects')
          })
        }}
      />
    )
  }

  if (!naming.value) {
    return (
      <Button
        icon="plus"
        label="Add library"
        onClick={() => {
          draftName.value = ''
          naming.value = true
        }}
      />
    )
  }

  const submit = (value: string) => {
    const title = value.trim()
    naming.value = false
    if (!title) return
    addAtPath(
      joinPath(fileSystem.defaultRoot.value, toDirectoryName(title)),
      title
    )
  }

  return (
    <div class="zds-library-add">
      <TextField
        label="Library name"
        hideLabel
        placeholder="Library name"
        value={draftName}
        autofocus
        onValueInput={(value) => {
          draftName.value = value
        }}
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key === 'Escape') naming.value = false
        }}
      />
      <Button
        variant="primary"
        label="Add"
        onClick={() => submit(draftName.value)}
      />
    </div>
  )
}
