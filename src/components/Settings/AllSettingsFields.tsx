import decamelize from 'decamelize'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { Setting } from 'lib/settings/initialSettings'
import { SetEventTypes, SettingsLevel } from 'lib/settings/settingsTypes'
import {
  shouldHideSetting,
  shouldShowSettingInput,
} from 'lib/settings/settingsUtils'
import { Fragment } from 'react/jsx-runtime'
import { SettingsSection } from './SettingsSection'
import { useLocation, useNavigate } from 'react-router-dom'
import { isDesktop } from 'lib/isDesktop'
import { ActionButton } from 'components/ActionButton'
import { SettingsFieldInput } from './SettingsFieldInput'
import { getInitialDefaultDir, showInFolder } from 'lib/desktop'
import toast from 'react-hot-toast'
import { APP_VERSION } from 'routes/Settings'
import { createAndOpenNewProject, getSettingsFolderPaths } from 'lib/tauriFS'
import { paths } from 'lib/paths'
import { useDotDotSlash } from 'hooks/useDotDotSlash'
import { sep } from '@tauri-apps/api/path'
import { ForwardedRef, forwardRef } from 'react'

interface AllSettingsFieldsProps {
  searchParamTab: SettingsLevel
  isFileSettings: boolean
}

export const AllSettingsFields = forwardRef(
  (
    { searchParamTab, isFileSettings }: AllSettingsFieldsProps,
    scrollRef: ForwardedRef<HTMLDivElement>
  ) => {
    const location = useLocation()
    const navigate = useNavigate()
    const dotDotSlash = useDotDotSlash()
    const {
      settings: { send, context },
    } = useSettingsAuthContext()

    const projectPath =
      isFileSettings && isDesktop()
        ? decodeURI(
            location.pathname
              .replace(paths.FILE + '/', '')
              .replace(paths.SETTINGS, '')
              .slice(0, decodeURI(location.pathname).lastIndexOf(sep()))
          )
        : undefined

    function restartOnboarding() {
      send({
        type: `set.app.onboardingStatus`,
        data: { level: 'user', value: '' },
      })

      if (isFileSettings) {
        navigate(dotDotSlash(1) + paths.ONBOARDING.INDEX)
      } else {
        createAndOpenNewProject(navigate)
      }
    }

    return (
      <div className="relative overflow-y-auto">
        <div ref={scrollRef} className="flex flex-col gap-4 px-2">
          {Object.entries(context)
            .filter(([_, categorySettings]) =>
              // Filter out categories that don't have any non-hidden settings
              Object.values(categorySettings).some(
                (setting) => !shouldHideSetting(setting, searchParamTab)
              )
            )
            .map(([category, categorySettings]) => (
              <Fragment key={category}>
                <h2
                  id={`category-${category}`}
                  className="text-xl mt-6 first-of-type:mt-0 capitalize font-bold"
                >
                  {decamelize(category, { separator: ' ' })}
                </h2>
                {Object.entries(categorySettings)
                  .filter(
                    // Filter out settings that don't have a Component or inputType
                    // or are hidden on the current level or the current platform
                    (item: [string, Setting<unknown>]) =>
                      shouldShowSettingInput(item[1], searchParamTab)
                  )
                  .map(([settingName, s]) => {
                    const setting = s as Setting
                    const parentValue =
                      setting[setting.getParentLevel(searchParamTab)]
                    return (
                      <SettingsSection
                        title={decamelize(settingName, {
                          separator: ' ',
                        })}
                        id={settingName}
                        className={
                          location.hash === `#${settingName}`
                            ? 'bg-primary/5 dark:bg-chalkboard-90'
                            : ''
                        }
                        key={`${category}-${settingName}-${searchParamTab}`}
                        description={setting.description}
                        settingHasChanged={
                          setting[searchParamTab] !== undefined &&
                          setting[searchParamTab] !==
                            setting.getFallback(searchParamTab)
                        }
                        parentLevel={setting.getParentLevel(searchParamTab)}
                        onFallback={() =>
                          send({
                            type: `set.${category}.${settingName}`,
                            data: {
                              level: searchParamTab,
                              value:
                                parentValue !== undefined
                                  ? parentValue
                                  : setting.getFallback(searchParamTab),
                            },
                          } as SetEventTypes)
                        }
                      >
                        <SettingsFieldInput
                          category={category}
                          settingName={settingName}
                          settingsLevel={searchParamTab}
                          setting={setting}
                        />
                      </SettingsSection>
                    )
                  })}
              </Fragment>
            ))}
          <h2 id="settings-resets" className="text-2xl mt-6 font-bold">
            Resets
          </h2>
          <SettingsSection
            title="Onboarding"
            description="Replay the onboarding process"
          >
            <ActionButton
              Element="button"
              onClick={restartOnboarding}
              iconStart={{
                icon: 'refresh',
                size: 'sm',
                className: 'p-1',
              }}
            >
              Replay Onboarding
            </ActionButton>
          </SettingsSection>
          <SettingsSection
            title="Reset settings"
            description={`Restore settings to their default values. Your settings are saved in
                    ${
                      isDesktop()
                        ? ' a file in the app data folder for your OS.'
                        : " your browser's local storage."
                    }
                  `}
          >
            <div className="flex flex-col items-start gap-4">
              {isDesktop() && (
                <ActionButton
                  Element="button"
                  onClick={async () => {
                    const paths = await getSettingsFolderPaths(
                      projectPath ? decodeURIComponent(projectPath) : undefined
                    )
                    showInFolder(paths[searchParamTab])
                  }}
                  iconStart={{
                    icon: 'folder',
                    size: 'sm',
                    className: 'p-1',
                  }}
                >
                  Show in folder
                </ActionButton>
              )}
              <ActionButton
                Element="button"
                onClick={async () => {
                  const defaultDirectory = await getInitialDefaultDir()
                  send({
                    type: 'Reset settings',
                    defaultDirectory,
                  })
                  toast.success('Settings restored to default')
                }}
                iconStart={{
                  icon: 'refresh',
                  size: 'sm',
                  className: 'p-1 text-chalkboard-10',
                  bgClassName: 'bg-destroy-70',
                }}
              >
                Restore default settings
              </ActionButton>
            </div>
          </SettingsSection>
          <h2 id="settings-about" className="text-2xl mt-6 font-bold">
            About Modeling App
          </h2>
          <div className="text-sm mb-12">
            <p>
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
            <p className="max-w-2xl mt-6">
              Don't see the feature you want? Check to see if it's on{' '}
              <a
                href="https://github.com/KittyCAD/modeling-app/discussions"
                target="_blank"
                rel="noopener noreferrer"
              >
                our roadmap
              </a>
              , and start a discussion if you don't see it! Your feedback will
              help us prioritize what to build next.
            </p>
          </div>
        </div>
      </div>
    )
  }
)
