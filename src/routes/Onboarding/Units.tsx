import { faArrowRight, faXmark } from '@fortawesome/free-solid-svg-icons'
import { baseUnits, useStore } from '../../useStore'
import { ActionButton } from '../../components/ActionButton'
import { SettingsSection } from '../Settings'
import { Toggle } from '../../components/Toggle/Toggle'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

interface IntroductionProps extends React.PropsWithChildren {}

const Units = ({ children, ...props }: IntroductionProps) => {
  const navigate = useNavigate()
  const {
    setOnboardingStatus,
    defaultUnitSystem: ogDefaultUnitSystem,
    setDefaultUnitSystem: saveDefaultUnitSystem,
    defaultBaseUnit: ogDefaultBaseUnit,
    setDefaultBaseUnit: saveDefaultBaseUnit,
  } = useStore((s) => ({
    setOnboardingStatus: s.setOnboardingStatus,
    defaultUnitSystem: s.defaultUnitSystem,
    setDefaultUnitSystem: s.setDefaultUnitSystem,
    defaultBaseUnit: s.defaultBaseUnit,
    setDefaultBaseUnit: s.setDefaultBaseUnit,
  }))
  const [defaultUnitSystem, setDefaultUnitSystem] =
    useState(ogDefaultUnitSystem)
  const [defaultBaseUnit, setDefaultBaseUnit] = useState(ogDefaultBaseUnit)

  function handleNextClick() {
    setOnboardingStatus('camera')
    saveDefaultUnitSystem(defaultUnitSystem)
    saveDefaultBaseUnit(defaultBaseUnit)
    navigate('/onboarding/camera')
  }

  return (
    <div className="fixed grid place-content-center inset-0 bg-chalkboard-110/50 z-50">
      <div className="max-w-3xl bg-white p-8 rounded">
        <h1 className="text-2xl font-bold">Set your units</h1>
        <SettingsSection
          title="Unit System"
          description="Which unit system to use by default"
        >
          <Toggle
            offLabel="Imperial"
            onLabel="Metric"
            name="settings-units"
            checked={defaultUnitSystem === 'metric'}
            onChange={(e) =>
              setDefaultUnitSystem(e.target.checked ? 'metric' : 'imperial')
            }
          />
        </SettingsSection>
        <SettingsSection
          title="Base Unit"
          description="Which base unit to use in dimensions by default"
        >
          <select
            id="base-unit"
            className="block w-full px-3 py-1 border border-chalkboard-30 bg-transparent"
            value={defaultBaseUnit}
            onChange={(e) => setDefaultBaseUnit(e.target.value)}
          >
            {baseUnits[defaultUnitSystem].map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </SettingsSection>
        <div className="flex justify-between mt-6">
          <ActionButton
            as="link"
            to="/"
            onClick={() => setOnboardingStatus('dismissed')}
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
          <ActionButton onClick={handleNextClick}
            icon={{ icon: faArrowRight }}
          >
            Next: Camera
          </ActionButton>
        </div>
      </div>
    </div>
  )
}

export default Units
