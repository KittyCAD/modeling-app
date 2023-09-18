import {
  faArrowRotateBack,
  faFolder,
  faXmark,
} from '@fortawesome/free-solid-svg-icons'
import { ActionButton } from '../components/ActionButton'
import { AppHeader } from '../components/AppHeader'
import { open } from '@tauri-apps/api/dialog'
import {
  BaseUnit,
  DEFAULT_PROJECT_NAME,
  baseUnits,
} from '../machines/settingsMachine'
import { Toggle } from '../components/Toggle/Toggle'
import { useLocation, useNavigate, useRouteLoaderData } from 'react-router-dom'
import { useHotkeys } from 'react-hotkeys-hook'
import { IndexLoaderData, paths } from '../Router'
import { Themes } from '../lib/theme'
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'
import {
  CameraSystem,
  cameraSystems,
  cameraMouseDragGuards,
} from 'lib/cameraControls'
import { UnitSystem } from 'machines/settingsMachine'

export const Settings = () => {
  const loaderData = useRouteLoaderData(paths.FILE) as IndexLoaderData
  const navigate = useNavigate()
  const location = useLocation()
  useHotkeys('esc', () =>
    navigate(location.pathname.slice(0, location.pathname.lastIndexOf('/')))
  )
  const {
    settings: {
      send,
      state: {
        context: {
          baseUnit,
          cameraControls,
          defaultDirectory,
          defaultProjectName,
          showDebugPanel,
          theme,
          unitSystem,
        },
      },
    },
  } = useGlobalStateContext()

  async function handleDirectorySelection() {
    const newDirectory = await open({
      directory: true,
      defaultPath: defaultDirectory || paths.INDEX,
      title: 'Choose a new default directory',
    })

    if (newDirectory && newDirectory !== null && !Array.isArray(newDirectory)) {
      send({
        type: 'Set Default Directory',
        data: { defaultDirectory: newDirectory },
      })
    }
  }

  return (
    <div className="body-bg fixed inset-0 z-40 overflow-auto">
      <AppHeader showToolbar={false} project={loaderData?.project}>
        <ActionButton
          Element="link"
          to={location.pathname.replace(paths.SETTINGS, '')}
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
      <div className="my-24 max-w-5xl mx-auto">
        <h1 className="text-4xl font-bold">User Settings</h1>
        <p className="mt-6 max-w-2xl">
          Don't see the feature you want? Check to see if it's on{' '}
          <a
            href="https://github.com/KittyCAD/modeling-app/discussions"
            target="_blank"
            rel="noopener noreferrer"
          >
            our roadmap
          </a>
          , and start a discussion if you don't see it! Your feedback will help
          us prioritize what to build next.
        </p>
        <SettingsSection
          title="Camera Controls"
          description="How you want to control the camera in the 3D view"
        >
          <select
            id="camera-controls"
            className="block w-full px-3 py-1 border border-chalkboard-30 bg-transparent"
            value={cameraControls}
            onChange={(e) => {
              send({
                type: 'Set Camera Controls',
                data: { cameraControls: e.target.value as CameraSystem },
              })
            }}
          >
            {cameraSystems.map((program) => (
              <option key={program} value={program}>
                {program}
              </option>
            ))}
          </select>
          <ul className="text-sm my-2 mx-4 leading-relaxed">
            <li>
              <strong>Pan:</strong>{' '}
              {cameraMouseDragGuards[cameraControls].pan.description}
            </li>
            <li>
              <strong>Zoom:</strong>{' '}
              {cameraMouseDragGuards[cameraControls].zoom.description}
            </li>
            <li>
              <strong>Rotate:</strong>{' '}
              {cameraMouseDragGuards[cameraControls].rotate.description}
            </li>
          </ul>
        </SettingsSection>
        {(window as any).__TAURI__ && (
          <>
            <SettingsSection
              title="Default Directory"
              description="Where newly-created projects are saved on your local computer"
            >
              <div className="w-full flex gap-4 p-1 rounded border border-chalkboard-30">
                <input
                  className="flex-1 px-2 bg-transparent"
                  value={defaultDirectory}
                  disabled
                />
                <ActionButton
                  Element="button"
                  className="bg-chalkboard-100 dark:bg-chalkboard-90 hover:bg-chalkboard-90 dark:hover:bg-chalkboard-80 !text-chalkboard-10 border-chalkboard-100 hover:border-chalkboard-70"
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
            <SettingsSection
              title="Default Project Name"
              description="Name template for new projects. Use $n to include an incrementing index"
            >
              <input
                className="block w-full px-3 py-1 border border-chalkboard-30 bg-transparent"
                defaultValue={defaultProjectName}
                onBlur={(e) => {
                  const newValue = e.target.value.trim() || DEFAULT_PROJECT_NAME
                  send({
                    type: 'Set Default Project Name',
                    data: {
                      defaultProjectName: newValue,
                    },
                  })
                  e.target.value = newValue
                }}
                autoCapitalize="off"
                autoComplete="off"
              />
            </SettingsSection>
          </>
        )}
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
            {baseUnits[unitSystem as keyof typeof baseUnits].map((unit) => (
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
            checked={showDebugPanel}
            onChange={(e) => {
              send('Toggle Debug Panel')
            }}
          />
        </SettingsSection>
        <SettingsSection
          title="Editor Theme"
          description="Apply a light or dark theme to the editor"
        >
          <select
            id="settings-theme"
            className="block w-full px-3 py-1 border border-chalkboard-30 bg-transparent"
            value={theme}
            onChange={(e) => {
              send({
                type: 'Set Theme',
                data: { theme: e.target.value as Themes },
              })
            }}
          >
            {Object.entries(Themes).map(([label, value]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </SettingsSection>
        {location.pathname.includes(paths.FILE) && (
          <SettingsSection
            title="Onboarding"
            description="Replay the onboarding process"
          >
            <ActionButton
              Element="button"
              onClick={() => {
                send({
                  type: 'Set Onboarding Status',
                  data: { onboardingStatus: '' },
                })
                navigate('..' + paths.ONBOARDING.INDEX)
              }}
              icon={{ icon: faArrowRotateBack }}
            >
              Replay Onboarding
            </ActionButton>
          </SettingsSection>
        )}
      </div>
    </div>
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
    <section className="my-16 last-of-type:mb-24 grid grid-cols-2 gap-12 items-start">
      <div className="w-80">
        <h2 className="text-2xl">{title}</h2>
        <p className="mt-2 text-sm">{description}</p>
      </div>
      <div>{children}</div>
    </section>
  )
}
