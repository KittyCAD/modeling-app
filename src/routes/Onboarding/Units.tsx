import { faArrowRight, faXmark } from '@fortawesome/free-solid-svg-icons'

import { ActionButton } from '@src/components/ActionButton'
import { SettingsSection } from '@src/components/Settings/SettingsSection'
import { type BaseUnit, baseUnitsUnion } from '@src/lib/settings/settingsTypes'
import { settingsActor, useSettings } from '@src/machines/appMachine'
import { onboardingPaths } from '@src/routes/Onboarding/paths'

import { useDismiss, useNextClick } from '@src/routes/Onboarding/utils'

export default function Units() {
  const dismiss = useDismiss()
  const next = useNextClick(onboardingPaths.CAMERA)
  const {
    modeling: { defaultUnit },
  } = useSettings()

  return (
    <div className="fixed grid place-content-center inset-0 bg-chalkboard-110/50 z-50">
      <div className="max-w-3xl bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded">
        <h1 className="text-2xl font-bold">Set your units</h1>
        <SettingsSection
          title="Default Unit"
          description="Which unit to use in modeling dimensions by default"
        >
          <select
            id="base-unit"
            className="block w-full px-3 py-1 border border-chalkboard-30 bg-transparent"
            value={defaultUnit.user}
            onChange={(e) => {
              settingsActor.send({
                type: 'set.modeling.defaultUnit',
                data: {
                  level: 'user',
                  value: e.target.value as BaseUnit,
                },
              })
            }}
          >
            {baseUnitsUnion.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </SettingsSection>
        <div className="flex justify-between mt-6">
          <ActionButton
            Element="button"
            onClick={dismiss}
            iconStart={{
              icon: faXmark,
              bgClassName: 'bg-destroy-80',
              iconClassName:
                'text-destroy-20 group-hover:text-destroy-10 hover:text-destroy-10',
            }}
            className="hover:border-destroy-40"
          >
            Dismiss
          </ActionButton>
          <ActionButton
            Element="button"
            onClick={next}
            iconStart={{ icon: faArrowRight }}
          >
            Next: Camera
          </ActionButton>
        </div>
      </div>
    </div>
  )
}
