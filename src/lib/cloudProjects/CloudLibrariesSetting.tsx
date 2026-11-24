import { useSignals } from '@preact/signals-react/runtime'
import { ActionButton } from '@src/components/ActionButton'
import { CREATE_CLOUD_LIBRARY_COMMAND } from '@src/lib/cloudProjects/commands'
import { selectCommand } from '@src/lib/commandUtils'
import { PATHS } from '@src/lib/paths'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  projectLibrariesFromSettings,
} from '@src/lib/projectLibraries'
import type { ExtensionSettingsContribution } from '@src/lib/settings/extensionSettings'
import { Setting } from '@src/lib/settings/Setting'
import type { SettingComponentProps } from '@src/lib/settings/settingsTypes'
import { reportRejection } from '@src/lib/trap'
import { toSync } from '@src/lib/utils'
import {
  commandsFacet,
  commandSystemService,
} from '@src/registry/contracts/commands'
import { projectLibraryTypesFacet } from '@src/registry/contracts/projectLibraries'
import { routerService } from '@src/registry/contracts/router'

function CloudLibrariesSetting({
  registry,
  settingsContext,
}: SettingComponentProps<undefined>) {
  useSignals()
  const cloudLibraries = projectLibrariesFromSettings(
    settingsContext.app.libraries?.currentSignal.value ?? [],
    registry.observe(projectLibraryTypesFacet).value
  ).filter(
    (library) =>
      library.type === CLOUD_PROJECT_LIBRARY_TYPE && !library.hiddenByDefault
  )
  const commands = registry.optional(commandSystemService)
  const cloudCommand = registry
    .observe(commandsFacet)
    .value.find(
      (command) =>
        command.groupId === 'projects' &&
        command.name === CREATE_CLOUD_LIBRARY_COMMAND
    )

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ul aria-label="Cloud libraries" className="flex min-w-0 flex-col gap-2">
        {cloudLibraries.map((library) => (
          <li
            key={library.id}
            className="flex min-w-0 items-center gap-2 rounded-sm border b-4 p-2 text-sm"
          >
            <span className="min-w-0 flex-1 truncate" title={library.title}>
              {library.title}
            </span>
            <span className="text-2">
              {library.organizationId ? 'Organization' : 'Personal'}
            </span>
          </li>
        ))}
      </ul>
      {commands && cloudCommand && !cloudCommand.disabled && (
        <ActionButton
          Element="button"
          type="button"
          tabIndex={0}
          className="self-start"
          onClick={toSync(async () => {
            const router = registry.required(routerService)
            await router.navigate(
              router.getLocation().pathname.replace(PATHS.SETTINGS, ''),
              { flushSync: true }
            )
            selectCommand(commands, {
              groupId: cloudCommand.groupId,
              name: cloudCommand.name,
            })
          }, reportRejection)}
          iconStart={{ icon: 'cloud', size: 'sm', className: 'p-1' }}
        >
          New cloud library
        </ActionButton>
      )}
    </div>
  )
}

export const cloudLibrariesSettingsContribution: ExtensionSettingsContribution =
  {
    app: {
      cloudLibraries: {
        createSetting: () =>
          new Setting<undefined>({
            title: 'Cloud Libraries',
            description:
              'Libraries stored in your Zoo account or shared with your organization.',
            defaultValue: undefined,
            hideOnLevel: 'project',
            validate: () => false,
            Component: CloudLibrariesSetting,
          }),
      },
    },
  }
