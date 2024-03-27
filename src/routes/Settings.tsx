import { faArrowRotateBack, faXmark } from '@fortawesome/free-solid-svg-icons'
import { ActionButton } from '../components/ActionButton'
import { AppHeader } from '../components/AppHeader'
import { SETTINGS_PERSIST_KEY } from 'lib/constants'
import {
  SetEventTypes,
  SettingsLevel,
  WildcardSetEvent,
} from 'lib/settings/settingsTypes'
import { Toggle } from 'components/Toggle/Toggle'
import { useLocation, useNavigate, useRouteLoaderData } from 'react-router-dom'
import { useHotkeys } from 'react-hotkeys-hook'
import { type IndexLoaderData } from 'lib/types'
import { paths } from 'lib/paths'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { useDotDotSlash } from 'hooks/useDotDotSlash'
import {
  createNewProject,
  getNextProjectIndex,
  getProjectsInDir,
  getSettingsFolderPaths,
  interpolateProjectNameWithIndex,
} from 'lib/tauriFS'
import { ONBOARDING_PROJECT_NAME } from './Onboarding'
import { sep } from '@tauri-apps/api/path'
import { bracket } from 'lib/exampleKcl'
import { isTauri } from 'lib/isTauri'
import { invoke } from '@tauri-apps/api'
import toast from 'react-hot-toast'
import React, { useMemo, useState } from 'react'
import { Setting } from 'lib/settings/initialSettings'
import decamelize from 'decamelize'
import { Event } from 'xstate'

export const Settings = () => {
  const APP_VERSION = import.meta.env.PACKAGE_VERSION || 'unknown'
  const loaderData =
    (useRouteLoaderData(paths.FILE) as IndexLoaderData) || undefined
  const navigate = useNavigate()
  const location = useLocation()
  const isFileSettings = location.pathname.includes(paths.FILE)
  const [settingsLevel, setSettingsLevel] = useState<SettingsLevel>(
    isFileSettings ? 'project' : 'user'
  )
  const dotDotSlash = useDotDotSlash()
  useHotkeys('esc', () => navigate(dotDotSlash()))
  const {
    settings: {
      send,
      state: { context },
    },
  } = useSettingsAuthContext()

  function restartOnboarding() {
    send({
      type: `set.app.onboardingStatus`,
      data: { level: 'user', value: '' },
    })

    if (isFileSettings) {
      navigate(dotDotSlash(1) + paths.ONBOARDING.INDEX)
    } else {
      createAndOpenNewProject()
    }
  }

  async function createAndOpenNewProject() {
    const defaultDirectory = context.app.projectDirectory.current
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
      defaultDirectory + sep + name,
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
          {isFileSettings && (
            <Toggle
              offLabel="User"
              onLabel="Project"
              onChange={() =>
                setSettingsLevel((v: SettingsLevel) =>
                  v === 'project' ? 'user' : 'project'
                )
              }
              checked={settingsLevel === 'project'}
              name="settings-level"
            />
          )}
        </p>
        {Object.entries(context)
          .filter(([_, categorySettings]) =>
            // Filter out categories that don't have any non-hidden settings
            Object.values(categorySettings).some(
              (c: Setting) => c.hideOnLevel !== settingsLevel
            )
          )
          .map(([category, categorySettings]) => (
            <div key={category}>
              <h2 className="text-lg capitalize font-bold">
                {decamelize(category, { separator: ' ' })}
              </h2>
              {Object.entries(categorySettings)
                .filter(
                  // Filter out settings that don't have a Component or inputType
                  // or are hidden on the current level
                  (item: [string, Setting<unknown>]) =>
                    item[1].hideOnLevel !== settingsLevel &&
                    (item[1].Component || item[1].commandConfig?.inputType)
                )
                .map(([settingName, s]) => (
                  <SettingsSection
                    title={decamelize(settingName, { separator: ' ' })}
                    key={`${category}-${settingName}-${settingsLevel}`}
                  >
                    <GeneratedSetting
                      category={category}
                      settingName={settingName}
                      settingsLevel={settingsLevel}
                      setting={s as Setting}
                    />
                  </SettingsSection>
                ))}
            </div>
          ))}
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
        <p className="font-mono my-6 leading-loose">
          Your settings are saved in{' '}
          {isTauri()
            ? 'a file in the app data folder for your OS.'
            : "your browser's local storage."}{' '}
          {isTauri() ? (
            <span className="flex gap-4 flex-wrap items-center">
              <button
                onClick={async () => {
                  const paths = await getSettingsFolderPaths()
                  void invoke('show_in_folder', {
                    path: paths.user,
                  })
                }}
                className="text-base"
              >
                Show settings.json in folder
              </button>
              <button
                onClick={async () => {
                  // We have to re-call initializeProjectDirectory
                  // since we can't set that in the settings machine's
                  // initial context due to it being async
                  send({
                    type: 'Reset settings',
                  })
                  toast.success('Settings restored to default')
                }}
                className="text-base"
              >
                Restore default settings
              </button>
            </span>
          ) : (
            <button
              onClick={() => {
                localStorage.removeItem(SETTINGS_PERSIST_KEY)
                send({ type: 'Reset settings' })
                toast.success('Settings restored to default')
              }}
              className="text-base"
            >
              Restore default settings
            </button>
          )}
        </p>
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
  headingClassName?: string
}

export function SettingsSection({
  title,
  description,
  className,
  children,
  headingClassName = 'text-2xl font-bold',
}: SettingsSectionProps) {
  return (
    <section
      className={
        'my-16 last-of-type:mb-24 grid grid-cols-2 gap-12 items-start ' +
        className
      }
    >
      <div className="w-80">
        <h2 className={headingClassName}>{title}</h2>
        <p className="mt-2 text-sm">{description}</p>
      </div>
      <div>{children}</div>
    </section>
  )
}

interface GeneratedSettingProps {
  // We don't need the fancy types here,
  // it doesn't help us with autocomplete or anything
  category: string
  settingName: string
  settingsLevel: SettingsLevel
  setting: Setting<unknown>
}

function GeneratedSetting({
  category,
  settingName,
  settingsLevel,
  setting,
}: GeneratedSettingProps) {
  const {
    settings: { context, send },
  } = useSettingsAuthContext()
  const options = useMemo(() => {
    return setting.commandConfig &&
      'options' in setting.commandConfig &&
      setting.commandConfig.options
      ? setting.commandConfig.options instanceof Array
        ? setting.commandConfig.options
        : setting.commandConfig.options(
            {
              argumentsToSubmit: {
                level: settingsLevel,
              },
            },
            context
          )
      : []
  }, [setting, settingsLevel, context])

  if (setting.Component)
    return (
      <setting.Component
        value={setting[settingsLevel] || setting.getFallback(settingsLevel)}
        onChange={(e) => {
          if ('value' in e.target) {
            send({
              type: `set.${category}.${settingName}`,
              data: {
                level: settingsLevel,
                value: e.target.value,
              },
            } as unknown as Event<WildcardSetEvent>)
          }
        }}
      />
    )

  switch (setting.commandConfig?.inputType) {
    case 'boolean':
      return (
        <Toggle
          offLabel="Off"
          onLabel="On"
          onChange={(e) =>
            send({
              type: `set.${category}.${settingName}`,
              data: {
                level: settingsLevel,
                value: Boolean(e.target.checked),
              },
            } as SetEventTypes)
          }
          checked={Boolean(
            setting[settingsLevel] !== undefined
              ? setting[settingsLevel]
              : setting.getFallback(settingsLevel)
          )}
          name={`${category}-${settingName}`}
        />
      )
    case 'options':
      return (
        <select
          value={String(
            setting[settingsLevel] || setting.getFallback(settingsLevel)
          )}
          onChange={(e) =>
            send({
              type: `set.${category}.${settingName}`,
              data: {
                level: settingsLevel,
                value: e.target.value,
              },
            } as unknown as Event<WildcardSetEvent>)
          }
        >
          {options &&
            options.length > 0 &&
            options.map((option) => (
              <option key={option.name} value={String(option.value)}>
                {option.name}
              </option>
            ))}
        </select>
      )
    case 'string':
      return (
        <input
          type="text"
          defaultValue={String(
            setting[settingsLevel] || setting.getFallback(settingsLevel)
          )}
          onBlur={(e) =>
            send({
              type: `set.${category}.${settingName}`,
              data: {
                level: settingsLevel,
                value: e.target.value,
              },
            } as unknown as Event<WildcardSetEvent>)
          }
        />
      )
  }
  return (
    <p className="text-destroy-70 dark:text-destroy-20">
      No component or input type found for setting {settingName} in category{' '}
      {category}
    </p>
  )
}
