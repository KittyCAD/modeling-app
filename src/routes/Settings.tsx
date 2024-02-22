import { faArrowRotateBack, faXmark } from '@fortawesome/free-solid-svg-icons'
import { ActionButton } from '../components/ActionButton'
import { AppHeader } from '../components/AppHeader'
import { open } from '@tauri-apps/plugin-dialog'
import {
  BaseUnit,
  DEFAULT_PROJECT_NAME,
  baseUnits,
} from '../machines/settingsMachine'
import { Toggle } from '../components/Toggle/Toggle'
import { useLocation, useNavigate, useRouteLoaderData } from 'react-router-dom'
import { useHotkeys } from 'react-hotkeys-hook'
import { type IndexLoaderData } from 'lib/types'
import { paths } from 'lib/paths'
import { Themes } from '../lib/theme'
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'
import {
  CameraSystem,
  cameraSystems,
  cameraMouseDragGuards,
} from 'lib/cameraControls'
import { UnitSystem } from 'machines/settingsMachine'
import { useDotDotSlash } from 'hooks/useDotDotSlash'
import {
  createNewProject,
  getNextProjectIndex,
  getProjectsInDir,
  interpolateProjectNameWithIndex,
} from 'lib/tauriFS'
import { ONBOARDING_PROJECT_NAME } from './Onboarding'
import { join, sep } from '@tauri-apps/api/path'
import { bracket } from 'lib/exampleKcl'

export const Settings = () => {
  const APP_VERSION = import.meta.env.PACKAGE_VERSION || 'unknown'
  const loaderData =
    (useRouteLoaderData(paths.FILE) as IndexLoaderData) || undefined
  const navigate = useNavigate()
  const location = useLocation()
  const isFileSettings = location.pathname.includes(paths.FILE)
  const dotDotSlash = useDotDotSlash()
  useHotkeys('esc', () => navigate(dotDotSlash()))
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

  function restartOnboarding() {
    send({
      type: 'Set Onboarding Status',
      data: { onboardingStatus: '' },
    })

    if (isFileSettings) {
      navigate(dotDotSlash(1) + paths.ONBOARDING.INDEX)
    } else {
      createAndOpenNewProject()
    }
  }

  async function createAndOpenNewProject() {
    const projects = await getProjectsInDir(defaultDirectory)
    const nextIndex = await getNextProjectIndex(
      ONBOARDING_PROJECT_NAME,
      projects
    )
    const name = interpolateProjectNameWithIndex(
      ONBOARDING_PROJECT_NAME,
      nextIndex
    )
    const newFile = await createNewProject(
      await join(defaultDirectory, name),
      bracket
    )
    navigate(`${paths.FILE}/${encodeURIComponent(newFile.path)}`)
  }

  return (
    <div className="fixed inset-0 z-40 overflow-auto body-bg">
      <AppHeader showToolbar={false} project={loaderData}>
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
          data-testid="close-button"
        >
          Close
        </ActionButton>
      </AppHeader>
      <div className="max-w-4xl mx-5 lg:mx-auto my-24">
        <h1 className="text-4xl font-bold">User Settings</h1>
        <p className="max-w-2xl mt-6">
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
            className="block w-full px-3 py-1 bg-transparent border border-chalkboard-30"
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
          <ul className="mx-4 my-2 text-sm leading-relaxed">
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
              <div className="flex w-full gap-4 p-1 border rounded border-chalkboard-30">
                <input
                  className="flex-1 px-2 bg-transparent"
                  value={defaultDirectory}
                  disabled
                  data-testid="default-directory-input"
                />
                <ActionButton
                  Element="button"
                  onClick={handleDirectorySelection}
                  icon={{
                    icon: 'folder',
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
                className="block w-full px-3 py-1 bg-transparent border border-chalkboard-30"
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
                data-testid="name-input"
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
            className="block w-full px-3 py-1 bg-transparent border border-chalkboard-30"
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
            className="block w-full px-3 py-1 bg-transparent border border-chalkboard-30"
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
        <SettingsSection
          title="Onboarding"
          description="Replay the onboarding process"
        >
          <ActionButton
            Element="button"
            onClick={restartOnboarding}
            icon={{ icon: faArrowRotateBack, size: 'sm', className: 'p-1' }}
          >
            Replay Onboarding
          </ActionButton>
        </SettingsSection>
        <p className="mt-24 text-sm font-mono">
          {/* This uses a Vite plugin, set in vite.config.ts
              to inject the version from package.json */}
          App version {APP_VERSION}.{' '}
          <a
            href={`https://github.com/KittyCAD/modeling-app/releases/tag/v${APP_VERSION}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View release on GitHub
          </a>
        </p>
      </div>
    </div>
  )
}

interface SettingsSectionProps extends React.PropsWithChildren {
  title: string
  description?: string
  className?: string
}

export function SettingsSection({
  title,
  description,
  className,
  children,
}: SettingsSectionProps) {
  return (
    <section
      className={
        'my-16 last-of-type:mb-24 grid grid-cols-2 gap-12 items-start ' +
        className
      }
    >
      <div className="w-80">
        <h2 className="text-2xl font-bold">{title}</h2>
        <p className="mt-2 text-sm">{description}</p>
      </div>
      <div>{children}</div>
    </section>
  )
}
