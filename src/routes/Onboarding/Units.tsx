import { faArrowRight, faXmark } from '@fortawesome/free-solid-svg-icons'
import { BaseUnit, baseUnits } from '../../machines/settingsMachine'
import { ActionButton } from '../../components/ActionButton'
import { SettingsSection } from '../Settings'
import { Toggle } from '../../components/Toggle/Toggle'
import { onboardingPaths, useDismiss, useNextClick } from '.'
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'
import { UnitSystem } from 'machines/settingsMachine'

export default function Units() {
  const dismiss = useDismiss()
  const next = useNextClick(onboardingPaths.CAMERA)
  const {
    settings: {
      send,
      context: { unitSystem, baseUnit },
    },
  } = useGlobalStateContext()

  return (
    <div className="fixed grid place-content-center inset-0 bg-chalkboard-110/50 z-50">
      <div className="max-w-3xl bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded">
        <h1 className="text-2xl font-bold">Set your units</h1>
        <SettingsSection
          title="Unit System"
          description="Which unit system to use by default"
        >
          <Toggle
            offLabel="Imperial"
            onLabel="Metric"
            name="settings-units"
            checked={unitSystem === UnitSystem.Metric}
            onChange={(e) => {
              const newUnitSystem = e.target.checked
                ? UnitSystem.Metric
                : UnitSystem.Imperial
              send({
                type: 'Set Unit System',
                data: { unitSystem: newUnitSystem },
              })
            }}
          />
        </SettingsSection>
        <SettingsSection
          title="Base Unit"
          description="Which base unit to use in dimensions by default"
        >
          <select
            id="base-unit"
            className="block w-full px-3 py-1 border border-chalkboard-30 bg-transparent"
            value={baseUnit}
            onChange={(e) => {
              send({
                type: 'Set Base Unit',
                data: { baseUnit: e.target.value as BaseUnit },
              })
            }}
          >
            {baseUnits[unitSystem].map((unit) => (
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
            icon={{
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
            icon={{ icon: faArrowRight }}
          >
            Next: Camera
          </ActionButton>
        </div>
      </div>
    </div>
  )
}
