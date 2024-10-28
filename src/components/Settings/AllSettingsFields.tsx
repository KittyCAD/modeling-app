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
import toast from 'react-hot-toast'
import { APP_VERSION } from 'routes/Settings'
import { PATHS } from 'lib/paths'
import { createAndOpenNewProject, getSettingsFolderPaths } from 'lib/desktopFS'
import { useDotDotSlash } from 'hooks/useDotDotSlash'
import { ForwardedRef, forwardRef, useEffect } from 'react'
import { useLspContext } from 'components/LspProvider'
import { toSync } from 'lib/utils'
import { reportRejection } from 'lib/trap'

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
    const { onProjectOpen } = useLspContext()
    const dotDotSlash = useDotDotSlash()
    const {
      settings: { send, context, state },
    } = useSettingsAuthContext()

    const projectPath =
      isFileSettings && isDesktop()
        ? decodeURI(
            location.pathname
              .replace(PATHS.FILE + '/', '')
              .replace(PATHS.SETTINGS, '')
              .slice(
                0,
                decodeURI(location.pathname).lastIndexOf(
                  window.electron.path.sep
                )
              )
          )
        : undefined

    function restartOnboarding() {
      send({
        type: `set.app.onboardingStatus`,
        data: { level: 'user', value: '' },
      })
    }

    /**
     * A "listener" for the XState to return to "idle" state
     * when the user resets the onboarding, using the callback above
     */
    useEffect(() => {
      async function navigateToOnboardingStart() {
        if (
          state.context.app.onboardingStatus.user === '' &&
          state.matches('idle')
        ) {
          if (isFileSettings) {
            // If we're in a project, first navigate to the onboarding start here
            // so we can trigger the warning screen if necessary
            navigate(dotDotSlash(1) + PATHS.ONBOARDING.INDEX)
          } else {
            // If we're in the global settings, create a new project and navigate
            // to the onboarding start in that project
            await createAndOpenNewProject({ onProjectOpen, navigate })
          }
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      navigateToOnboardingStart()
    }, [isFileSettings, navigate, state])

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
                  onClick={toSync(async () => {
                    const paths = await getSettingsFolderPaths(
                      projectPath ? decodeURIComponent(projectPath) : undefined
                    )
                    const finalPath = paths[searchParamTab]
                    if (!finalPath) {
                      return new Error('finalPath undefined')
                    }
                    window.electron.showInFolder(finalPath)
                  }, reportRejection)}
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
                onClick={() => {
                  send({
                    type: 'Reset settings',
                    level: searchParamTab,
                  })
                  toast.success(
                    `Your ${searchParamTab}-level settings were reset`
                  )
                }}
                iconStart={{
                  icon: 'refresh',
                  size: 'sm',
                  className: 'p-1 text-chalkboard-10',
                  bgClassName: 'bg-destroy-70',
                }}
              >
                Reset {searchParamTab}-level settings
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
