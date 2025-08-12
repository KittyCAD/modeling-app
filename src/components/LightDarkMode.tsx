import type { ActorRefFrom } from 'xstate'
import type { settingsMachine } from '@src/machines/settingsMachine'
import { ActionButton } from '@src/components/ActionButton'
import { Themes } from '@src/lib/theme'

export function LightDarkToggle({
  settingsActor,
  settingsTheme,
}: {
  settingsActor: ActorRefFrom<typeof settingsMachine>
  settingsTheme: Themes
}) {
  return (
    <ActionButton
      Element="button"
      onClick={() => {
        let requestedTheme: Themes | null = null
        if (settingsTheme === Themes.Light) {
          requestedTheme = Themes.Dark
        } else if (settingsTheme === Themes.Dark) {
          requestedTheme = Themes.Light
        }
        if (requestedTheme) {
          settingsActor.send({
            type: 'set.app.theme',
            data: { level: 'user', value: requestedTheme },
          })
        }
      }}
      className="!bg-primary !text-chalkboard-10 !border-transarent py-1 self-end justify-self-end"
    >
      {settingsTheme === 'light' ? 'dark' : 'light'} mode
    </ActionButton>
  )
}
