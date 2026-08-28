import { Button, Icon, Select, TextField } from '@kittycad/ui-kit'
import { useComputed, useSignal } from '@preact/signals'
import { useService } from '@src/app/context'
import { authService } from '@src/contracts/auth'
import { fileSystemService } from '@src/contracts/fileSystem'
import { projectLibrariesService } from '@src/contracts/projectLibraries'
import { runtimeService } from '@src/contracts/runtime'
import { libraryIcon } from '@src/features/home/libraryIcon'
import { joinPath, uniqueName } from '@src/lib/paths'
import type {
  ProjectLibrary,
  ProjectLibrarySetting,
  ProjectLibraryType,
} from '@src/lib/projectLibraries'
import './projectLibrariesSettings.css'

/**
 * Project-library configuration is a body-only Settings section.
 *
 * Libraries are not cascade values: they are an ordered collection with
 * provider-owned fields and immediate discovery side effects. Keeping them in
 * their service also means Home and Settings always edit the same collection.
 */
export function ProjectLibrariesSettings() {
  const libraries = useService(projectLibrariesService)
  const fileSystem = useService(fileSystemService)
  const runtime = useService(runtimeService)
  const auth = useService(authService)
  const selectedType = useSignal<ProjectLibraryType>('')
  const libraryContext = {
    defaultRoot: fileSystem.defaultRoot.value,
    defaultCloudRoot: fileSystem.defaultCloudRoot.value,
    authStatus: auth.status.value,
    isAuthenticated: auth.status.value === 'signedIn',
    ...runtime.info.value,
  }

  const creatableTypes = useComputed(() =>
    Array.from(libraries.types.value.values())
      .filter((type) => type.newLibrarySetting !== undefined)
      .filter((type) => type.userCreatable !== false)
      .filter((type) => {
        const maximum = type.maximumInstances?.[runtime.info.value.target]
        return (
          maximum === undefined ||
          libraries.libraries.value.filter(
            (library) => library.type === type.type
          ).length < maximum
        )
      })
      .toSorted(
        (a, b) =>
          (a.order ?? Number.MAX_SAFE_INTEGER) -
            (b.order ?? Number.MAX_SAFE_INTEGER) ||
          a.title.localeCompare(b.title)
      )
  )

  const typeToAdd =
    creatableTypes.value.find((type) => type.type === selectedType.value) ??
    creatableTypes.value[0]

  const addLibrary = async () => {
    if (!typeToAdd?.newLibrarySetting) return

    let setting = typeToAdd.newLibrarySetting(libraryContext)

    // Choosing a folder is both configuration and permission granting on
    // desktop. Other types decide their address in their own template/details.
    if (typeToAdd.type === 'directory' && fileSystem.chooseDirectory) {
      const path = await fileSystem.chooseDirectory({
        title: 'Choose a folder for projects',
        defaultPath: setting.path,
      })
      if (!path) return
      const name = path.replaceAll('\\', '/').split('/').filter(Boolean).at(-1)
      setting = { ...setting, path, title: name || setting.title }
    } else if (typeToAdd.type === 'directory') {
      const root = fileSystem.defaultRoot.value
      const taken = libraries.libraries.value
        .filter((library) => library.path.startsWith(`${root}/`))
        .map((library) => library.path.slice(root.length + 1).split('/')[0])
      const name = uniqueName('project-library', taken)
      setting = { ...setting, path: joinPath(root, name) }
    }

    libraries.addLibrary(setting)
  }

  return (
    <div class="zds-library-settings">
      <ol class="zds-library-settings__list">
        {libraries.libraries.value.map((library, index) => (
          <LibrarySettingsRow
            key={library.id}
            library={library}
            index={index}
            count={libraries.libraries.value.length}
          />
        ))}
      </ol>

      {creatableTypes.value.length > 0 ? (
        <div class="zds-library-settings__add">
          {creatableTypes.value.length > 1 ? (
            <Select
              label="Library type"
              value={typeToAdd?.type ?? ''}
              options={creatableTypes.value.map((type) => ({
                value: type.type,
                label: type.title,
              }))}
              onValueChange={(type) => {
                selectedType.value = type
              }}
            />
          ) : (
            <p class="zds-library-settings__add-description">
              Add {typeToAdd?.title ?? 'library'}
            </p>
          )}
          <Button
            icon="plus"
            label="Add library"
            onClick={() => void addLibrary()}
          />
        </div>
      ) : null}
    </div>
  )
}

function LibrarySettingsRow({
  library,
  index,
  count,
}: {
  library: ProjectLibrary
  index: number
  count: number
}) {
  const libraries = useService(projectLibrariesService)
  const fileSystem = useService(fileSystemService)
  const runtime = useService(runtimeService)
  const auth = useService(authService)
  const type = libraries.type(library.type)
  const Details = type?.settingsDetails
  const typeOptions = Array.from(libraries.types.value.values())
    .filter(
      (candidate) =>
        candidate.newLibrarySetting !== undefined &&
        candidate.userCreatable !== false
    )
    .toSorted(
      (a, b) =>
        (a.order ?? Number.MAX_SAFE_INTEGER) -
          (b.order ?? Number.MAX_SAFE_INTEGER) || a.title.localeCompare(b.title)
    )
    .map((candidate) => ({
      value: candidate.type,
      label: candidate.title,
    }))
  if (!typeOptions.some((option) => option.value === library.type)) {
    typeOptions.push({ value: library.type, label: library.type })
  }

  const update = (patch: Partial<ProjectLibrarySetting>) =>
    libraries.updateLibrary(library.id, patch)

  const changeType = (nextType: ProjectLibraryType) => {
    if (nextType === library.type) return
    const contribution = libraries.type(nextType)
    const template = contribution?.newLibrarySetting?.({
      defaultRoot: fileSystem.defaultRoot.value,
      defaultCloudRoot: fileSystem.defaultCloudRoot.value,
      authStatus: auth.status.value,
      isAuthenticated: auth.status.value === 'signedIn',
      ...runtime.info.value,
    })
    if (!template) return
    update({
      ...template,
      source: template.source ?? '',
      title: library.title,
    })
  }

  return (
    <li class="zds-library-settings__row">
      <div class="zds-library-settings__heading">
        <span class="zds-library-settings__icon">
          <Icon name={libraryIcon(library, type)} />
        </span>
        <TextField
          class="zds-library-settings__title"
          label="Library name"
          hideLabel
          value={library.title}
          onValueInput={(title) => {
            if (title.trim()) update({ title })
          }}
        />
        <div class="zds-library-settings__order">
          <Button
            variant="ghost"
            size="small"
            icon="chevronUp"
            iconOnly
            label={`Move ${library.title} up`}
            disabled={index === 0}
            onClick={() => libraries.reorderLibrary(index, index - 1)}
          />
          <Button
            variant="ghost"
            size="small"
            icon="chevronDown"
            iconOnly
            label={`Move ${library.title} down`}
            disabled={index === count - 1}
            onClick={() => libraries.reorderLibrary(index, index + 1)}
          />
          {libraries.canRemoveLibrary(library.id) ? (
            <Button
              variant="ghost"
              size="small"
              icon="close"
              iconOnly
              label={`Remove ${library.title}`}
              onClick={() => libraries.removeLibrary(library.id)}
            />
          ) : null}
        </div>
      </div>

      <div class="zds-library-settings__common">
        <Select
          label="Type"
          value={library.type}
          options={typeOptions}
          disabled={type?.removable === false}
          onValueChange={changeType}
        />
        <p class="zds-library-settings__description">
          {type?.description ??
            `The ${library.type} library provider is not installed.`}
        </p>
      </div>

      {Details ? (
        <div class="zds-library-settings__details">
          <Details
            library={library}
            readOnly={false}
            update={update}
            chooseDirectory={fileSystem.chooseDirectory?.bind(fileSystem)}
          />
        </div>
      ) : (
        <p class="zds-library-settings__location zds-value">{library.path}</p>
      )}
    </li>
  )
}
