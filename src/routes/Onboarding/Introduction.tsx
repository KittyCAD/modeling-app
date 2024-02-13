import {
  ONBOARDING_PROJECT_NAME,
  OnboardingButtons,
  useDismiss,
  useNextClick,
} from '.'
import { onboardingPaths } from 'routes/Onboarding/paths'
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'
import { Themes, getSystemTheme } from 'lib/theme'
import { bracket } from 'lib/exampleKcl'
import {
  PROJECT_ENTRYPOINT,
  createNewProject,
  getNextProjectIndex,
  getProjectsInDir,
  interpolateProjectNameWithIndex,
} from 'lib/tauriFS'
import { isTauri } from 'lib/isTauri'
import { useNavigate } from 'react-router-dom'
import { paths } from 'lib/paths'
import { useEffect } from 'react'
import { kclManager } from 'lang/KclSingleton'
import { sep } from '@tauri-apps/api/path'
import { APP_NAME } from 'lib/constants'

function OnboardingWithNewFile() {
  const navigate = useNavigate()
  const dismiss = useDismiss()
  const next = useNextClick(onboardingPaths.INDEX)
  const {
    settings: {
      context: { defaultDirectory },
    },
  } = useGlobalStateContext()

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
      defaultDirectory + sep() + name,
      bracket
    )
    navigate(
      `${paths.FILE}/${encodeURIComponent(
        newFile.path + sep() + PROJECT_ENTRYPOINT
      )}${paths.ONBOARDING.INDEX}`
    )
  }
  return (
    <div className="fixed inset-0 z-50 grid place-content-center bg-chalkboard-110/50">
      <div className="max-w-3xl p-8 rounded bg-chalkboard-10 dark:bg-chalkboard-90">
        {!isTauri() ? (
          <>
            <h1 className="text-2xl font-bold text-warn-80 dark:text-warn-10">
              Replaying onboarding resets your code
            </h1>
            <p className="my-4">
              We see you have some of your own code written in this project.
              Please save it somewhere else before continuing the onboarding.
            </p>
            <OnboardingButtons
              className="mt-6"
              dismiss={dismiss}
              next={() => {
                kclManager.setCodeAndExecute(bracket)
                next()
              }}
              nextText="Overwrite code and continue"
            />
          </>
        ) : (
          <>
            <h1 className="flex flex-wrap items-center gap-4 text-2xl font-bold">
              Would you like to create a new project?
            </h1>
            <section className="my-12">
              <p className="my-4">
                You have some content in this project that we don't want to
                overwrite. If you would like to create a new project, please
                click the button below.
              </p>
            </section>
            <OnboardingButtons
              className="mt-6"
              dismiss={dismiss}
              next={() => {
                void createAndOpenNewProject()
                kclManager.setCode(bracket, false)
                dismiss()
              }}
              nextText="Make a new project"
            />
          </>
        )}
      </div>
    </div>
  )
}

export default function Introduction() {
  const {
    settings: {
      state: {
        context: { theme },
      },
    },
  } = useGlobalStateContext()
  const getLogoTheme = () =>
    theme === Themes.Light ||
    (theme === Themes.System && getSystemTheme() === Themes.Light)
      ? '-dark'
      : ''
  const dismiss = useDismiss()
  const next = useNextClick(onboardingPaths.CAMERA)
  const isStarterCode = kclManager.code === '' || kclManager.code === bracket

  useEffect(() => {
    if (kclManager.code === '') kclManager.setCode(bracket)
  }, [])

  return isStarterCode ? (
    <div className="fixed inset-0 z-50 grid place-content-center bg-chalkboard-110/50">
      <div className="max-w-3xl p-8 rounded bg-chalkboard-10 dark:bg-chalkboard-90">
        <h1 className="flex flex-wrap items-center gap-4 text-2xl font-bold">
          <img
            src={`/zma-logomark${getLogoTheme()}.svg`}
            alt={APP_NAME}
            className="h-20 max-w-full"
          />
          <span className="px-3 py-1 text-base rounded-full bg-energy-10 text-energy-80">
            Alpha
          </span>
        </h1>
        <section className="my-12">
          <p className="my-4">
            Welcome to {APP_NAME}! This is a hardware design tool that lets you
            edit visually, with code, or both. It's powered by the first API
            created for anyone to build hardware design tools. The 3D view is
            not running on your computer, but is instead being streamed to you
            from a remote GPU as video.
          </p>
          <p className="my-4">
            This is an alpha release, so you will encounter bugs and missing
            features. You can read our{' '}
            <a
              href="https://gist.github.com/jgomez720/5cd53fb7e8e54079f6dc0d2625de5393"
              target="_blank"
              rel="noreferrer noopener"
            >
              expectations for alpha users here
            </a>
            . Please give us feedback on your experience! We are trying to
            release as early as possible to get feedback from users like you.
          </p>
        </section>
        <OnboardingButtons
          className="mt-6"
          dismiss={dismiss}
          next={next}
          nextText="Camera"
        />
      </div>
    </div>
  ) : (
    <OnboardingWithNewFile />
  )
}
