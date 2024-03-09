import { OnboardingButtons, useDismiss, useNextClick } from '.'
import { onboardingPaths } from 'routes/Onboarding/paths'
import { useStore } from '../../useStore'
import { isTauri } from 'lib/isTauri'

export default function ProjectMenu() {
  const { buttonDownInStream } = useStore((s) => ({
    buttonDownInStream: s.buttonDownInStream,
  }))
  const dismiss = useDismiss()
  const next = useNextClick(onboardingPaths.EXPORT)
  const tauri = isTauri()

  return (
    <div className="fixed grid justify-center items-start inset-0 z-50 pointer-events-none">
      <div
        className={
          'max-w-xl flex flex-col border border-chalkboard-50 dark:border-chalkboard-80 shadow-lg justify-center bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded' +
          (buttonDownInStream ? '' : ' pointer-events-auto')
        }
      >
        <section className="flex-1">
          <h2 className="text-2xl font-bold">Project Menu</h2>
          <p className="my-4">
            Click on your part's name in the upper left to open the project
            menu.
            {tauri && (
              <> You can click the Zoo logo to quickly navigate home.</>
            )}
          </p>
          {tauri ? (
            <>
              <p className="my-4">
                From here you can manage files in your project and export your
                current part. Your projects are{' '}
                <strong>all saved locally</strong> as a folder on your device.
                You can configure where projects are saved in the settings.
              </p>
              <p className="my-4">
                We are working to support assemblies as separate kcl files
                importing parts from each other, but for now you can only open
                and export individual parts.
              </p>
            </>
          ) : (
            <>
              <p className="my-4">
                From here you can export your part. You can't manage separate
                files and separate projects from the browser; you have to{' '}
                <a
                  href="https://zoo.dev/modeling-app/download"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  download the desktop app
                </a>{' '}
                for that. We aren't hosting files for you at this time but are
                considering supporting it in the future, so we're building
                Modeling App with a browser-first experience in mind.
              </p>
            </>
          )}
        </section>
        <OnboardingButtons
          currentSlug={onboardingPaths.PROJECT_MENU}
          next={next}
          dismiss={dismiss}
          nextText="Next: Export"
        />
      </div>
    </div>
  )
}
