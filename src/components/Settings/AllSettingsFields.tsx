import decamelize from 'decamelize'
import type { ForwardedRef } from 'react'
import { forwardRef, useMemo } from 'react'
import toast from 'react-hot-toast'
import { useLocation, useNavigate } from 'react-router-dom'
import { Fragment } from 'react/jsx-runtime'

import { ActionButton } from '@src/components/ActionButton'
import { useLspContext } from '@src/components/LspProvider'
import { SettingsFieldInput } from '@src/components/Settings/SettingsFieldInput'
import { SettingsSection } from '@src/components/Settings/SettingsSection'
import { useDotDotSlash } from '@src/hooks/useDotDotSlash'
import {
  createAndOpenNewTutorialProject,
  getSettingsFolderPaths,
} from '@src/lib/desktopFS'
import { isDesktop } from '@src/lib/isDesktop'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import { PATHS } from '@src/lib/paths'
import type { Setting } from '@src/lib/settings/initialSettings'
import type {
  SetEventTypes,
  SettingsLevel,
} from '@src/lib/settings/settingsTypes'
import {
  shouldHideSetting,
  shouldShowSettingInput,
} from '@src/lib/settings/settingsUtils'
import { reportRejection } from '@src/lib/trap'
import { toSync } from '@src/lib/utils'
import { settingsActor, useSettings } from '@src/machines/appMachine'
import { APP_VERSION, IS_NIGHTLY, getReleaseUrl } from '@src/routes/utils'
import { waitFor } from 'xstate'

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
    const context = useSettings()

    const projectPath = useMemo(() => {
      const filteredPathname = location.pathname
        .replace(PATHS.FILE, '')
        .replace(PATHS.SETTINGS, '')
      const lastSlashIndex = filteredPathname.lastIndexOf(
        // This is slicing off any remaining browser path segments,
        // so we don't use window.electron.sep here
        '/'
      )
      const projectPath =
        isFileSettings && isDesktop()
          ? decodeURIComponent(filteredPathname.slice(lastSlashIndex + 1))
          : undefined

      return projectPath
    }, [location.pathname])

    async function restartOnboarding() {
      settingsActor.send({
        type: `set.app.onboardingStatus`,
        data: { level: 'user', value: '' },
      })
      await waitFor(settingsActor, (s) => s.matches('idle'), {
        timeout: 10_000,
      }).catch(reportRejection)

      if (isFileSettings) {
        // If we're in a project, first navigate to the onboarding start here
        // so we can trigger the warning screen if necessary
        navigate(dotDotSlash(1) + PATHS.ONBOARDING.INDEX)
      } else {
        // If we're in the global settings, create a new project and navigate
        // to the onboarding start in that project
        await createAndOpenNewTutorialProject({ onProjectOpen, navigate })
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
                          settingsActor.send({
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
                    const paths = await getSettingsFolderPaths(projectPath)
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
                  settingsActor.send({
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
            About Design Studio
          </h2>
          <div className="text-sm mb-12">
            <p>
              {/* This uses a Vite plugin, set in vite.config.ts
                  to inject the version from package.json */}
              App version {APP_VERSION}.{' '}
            </p>
            <div className="flex gap-2 flex-wrap my-4">
              <ActionButton
                Element="externalLink"
                to={getReleaseUrl()}
                iconStart={{ icon: 'file', className: 'p-1' }}
              >
                View release on GitHub
              </ActionButton>
              <ActionButton
                Element="button"
                onClick={() => {
                  window.electron.appCheckForUpdates().catch(reportRejection)
                }}
                iconStart={{
                  icon: 'refresh',
                  size: 'sm',
                  className: 'p-1',
                }}
              >
                Check for updates
              </ActionButton>
            </div>
            <p className="max-w-2xl mt-6">
              Don't see the feature you want? Check to see if it's on{' '}
              <a
                onClick={openExternalBrowserIfDesktop(
                  'https://github.com/KittyCAD/modeling-app/discussions'
                )}
                href="https://github.com/KittyCAD/modeling-app/discussions"
                target="_blank"
                rel="noopener noreferrer"
              >
                our roadmap
              </a>
              , and start a discussion if you don't see it! Your feedback will
              help us prioritize what to build next.
            </p>
            {!IS_NIGHTLY && (
              <p className="max-w-2xl mt-6">
                Want to experience the latest and (hopefully) greatest from our
                main development branch?{' '}
                <a
                  onClick={openExternalBrowserIfDesktop(
                    'https://zoo.dev/modeling-app/download/nightly'
                  )}
                  href="https://zoo.dev/modeling-app/download/nightly"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Click here to grab Zoo Design Studio (Nightly)
                </a>
                . It can be installed side-by-side with the stable version
                you're running now. But careful there, a lot less testing is
                involved in their release 🤖.
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }
)
