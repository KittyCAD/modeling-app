import {
  faArrowRotateBack,
  faCheck,
  faFolder,
  faXmark,
} from '@fortawesome/free-solid-svg-icons'
import { ActionButton } from '../components/ActionButton'
import { AppHeader } from '../components/AppHeader'
import { open } from '@tauri-apps/api/dialog'
import { baseUnits, useStore } from '../useStore'
import { useState } from 'react'
import { toast } from 'react-hot-toast'
import { Toggle } from '../components/Toggle/Toggle'
import { useNavigate } from 'react-router-dom'

export const Settings = () => {
  const navigate = useNavigate()
  const {
    defaultDir: ogDefaultDir,
    setDefaultDir: saveDefaultDir,
    defaultProjectName: ogDefaultProjectName,
    setDefaultProjectName: saveDefaultProjectName,
    defaultUnitSystem: ogDefaultUnitSystem,
    setDefaultUnitSystem: saveDefaultUnitSystem,
    defaultBaseUnit: ogDefaultBaseUnit,
    setDefaultBaseUnit: saveDefaultBaseUnit,
    saveDebugPanel,
    originalDebugPanel,
    setOnboardingStatus,
    theme: ogTheme,
    setTheme: saveTheme,
  } = useStore((s) => ({
    defaultDir: s.defaultDir,
    setDefaultDir: s.setDefaultDir,
    defaultProjectName: s.defaultProjectName,
    setDefaultProjectName: s.setDefaultProjectName,
    defaultUnitSystem: s.defaultUnitSystem,
    setDefaultUnitSystem: s.setDefaultUnitSystem,
    defaultBaseUnit: s.defaultBaseUnit,
    setDefaultBaseUnit: s.setDefaultBaseUnit,
    saveDebugPanel: s.setDebugPanel,
    originalDebugPanel: s.debugPanel,
    setOnboardingStatus: s.setOnboardingStatus,
    theme: s.theme,
    setTheme: s.setTheme,
  }))
  const [defaultDir, setDefaultDir] = useState(ogDefaultDir)
  const [defaultProjectName, setDefaultProjectName] =
    useState(ogDefaultProjectName)
  const [defaultUnitSystem, setDefaultUnitSystem] =
    useState(ogDefaultUnitSystem)
  const [defaultBaseUnit, setDefaultBaseUnit] = useState(ogDefaultBaseUnit)
  const [debugPanel, setDebugPanel] = useState(originalDebugPanel)
  const [theme, setTheme] = useState(ogTheme)

  async function handleDirectorySelection() {
    const newDirectory = await open({
      directory: true,
      defaultPath: (defaultDir.base || '') + (defaultDir.dir || '/'),
      title: 'Choose a new default directory',
    })

    if (newDirectory && newDirectory !== null && !Array.isArray(newDirectory)) {
      setDefaultDir({ base: defaultDir.base, dir: newDirectory })
    }
  }

  const handleSaveClick = () => {
    saveDefaultDir(defaultDir)
    saveDefaultProjectName(defaultProjectName)
    saveDefaultUnitSystem(defaultUnitSystem)
    saveDefaultBaseUnit(defaultBaseUnit)
    saveDebugPanel(debugPanel)
    saveTheme(theme)
    toast.success('Settings saved!')
  }

  return (
    <>
      <AppHeader showToolbar={false}>
        <ActionButton
          as="link"
          to="/"
          icon={{
            icon: faXmark,
            bgClassName: 'bg-destroy-80',
            iconClassName:
              'text-destroy-20 group-hover:text-destroy-10 hover:text-destroy-10',
          }}
          className="hover:border-destroy-40"
        >
          Close
        </ActionButton>
      </AppHeader>
      <div className="mt-24 max-w-5xl mx-auto">
        <h1 className="text-4xl font-bold">User Settings</h1>
        {(window as any).__TAURI__ && (
          <SettingsSection
            title="Default Directory"
            description="Where newly-created projects are saved on your local computer"
          >
            <div className="w-full flex gap-4 p-1 rounded border border-chalkboard-30">
              <input
                className="flex-1 px-2 bg-transparent"
                value={defaultDir.dir}
                onChange={(e) =>
                  setDefaultDir({
                    base: ogDefaultDir.base,
                    dir: e.target.value,
                  })
                }
              />
              <ActionButton
                as="button"
                className="bg-chalkboard-100 hover:bg-chalkboard-90 text-chalkboard-10 border-chalkboard-100 hover:border-chalkboard-70"
                onClick={handleDirectorySelection}
                icon={{
                  icon: faFolder,
                  bgClassName:
                    'bg-liquid-20 group-hover:bg-liquid-10 hover:bg-liquid-10',
                  iconClassName:
                    'text-liquid-90 group-hover:text-liquid-90 hover:text-liquid-90',
                }}
              >
                Choose a folder
              </ActionButton>
            </div>
          </SettingsSection>
        )}
        <SettingsSection
          title="Default Project Name"
          description="Name template for new projects. Use $n to include an incrementing index"
        >
          <input
            className="block w-full px-3 py-1 border border-chalkboard-30 bg-transparent"
            value={defaultProjectName}
            onChange={(e) => setDefaultProjectName(e.target.value)}
          />
        </SettingsSection>
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
        <SettingsSection
          title="Debug Panel"
          description="Show the debug panel in the editor"
        >
          <Toggle
            name="settings-debug-panel"
            checked={debugPanel}
            onChange={(e) => setDebugPanel(e.target.checked)}
          />
        </SettingsSection>
        <SettingsSection
          title="Editor Theme"
          description="Apply a light or dark theme to the editor"
        >
          <Toggle
            name="settings-theme"
            offLabel="Dark"
            onLabel="Light"
            checked={theme === 'light'}
            onChange={(e) => setTheme(e.target.checked ? 'light' : 'dark')}
          />
        </SettingsSection>
        <SettingsSection
          title="Onboarding"
          description="Replay the onboarding process"
        >
          <ActionButton
            onClick={() => {
              setOnboardingStatus('')
              navigate('/')
            }}
            icon={{ icon: faArrowRotateBack }}
          >
            Replay Onboarding
          </ActionButton>
        </SettingsSection>
        <ActionButton
          className="hover:border-succeed-50"
          onClick={handleSaveClick}
          icon={{
            icon: faCheck,
            bgClassName:
              'bg-succeed-80 group-hover:bg-succeed-70 hover:bg-succeed-70',
            iconClassName:
              'text-succeed-20 group-hover:text-succeed-10 hover:text-succeed-10',
          }}
        >
          Save Settings
        </ActionButton>
      </div>
    </>
  )
}

interface SettingsSectionProps extends React.PropsWithChildren {
  title: string
  description?: string
}

export function SettingsSection({
  title,
  description,
  children,
}: SettingsSectionProps) {
  return (
    <section className="my-8 first-of-type:mt-16 last-of-type:mb-16 flex gap-12 items-start">
      <div className="w-80">
        <h2 className="text-2xl">{title}</h2>
        <p className="mt-2 text-sm">{description}</p>
      </div>
      <div>{children}</div>
    </section>
  )
}
