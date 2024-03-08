import { OnboardingButtons, useDismiss, useNextClick } from '.'
import { onboardingPaths } from 'routes/Onboarding/paths'
import { useStore } from '../../useStore'
import { useBackdropHighlight } from 'hooks/useBackdropHighlight'
import { Themes, getSystemTheme } from 'lib/theme'
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'

export default function ParametricModeling() {
  const { buttonDownInStream } = useStore((s) => ({
    buttonDownInStream: s.buttonDownInStream,
  }))
  const {
    settings: {
      context: { theme },
    },
  } = useGlobalStateContext()
  const getImageTheme = () =>
    theme === Themes.Light ||
    (theme === Themes.System && getSystemTheme() === Themes.Light)
      ? '-dark'
      : ''
  const dismiss = useDismiss()
  const next = useNextClick(onboardingPaths.INTERACTIVE_NUMBERS)

  return (
    <div className="fixed grid justify-end items-center inset-0 z-50 pointer-events-none">
      <div
        className="fixed inset-0 bg-black dark:bg-black-80 opacity-50 pointer-events-none"
        style={{ clipPath: useBackdropHighlight('code-pane') }}
      ></div>
      <div
        className={
          'z-10 max-w-xl border border-chalkboard-50 dark:border-chalkboard-80 shadow-lg h-3/4 flex flex-col justify-center bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded' +
          (buttonDownInStream ? '' : ' pointer-events-auto')
        }
      >
        <section className="flex-1 overflow-y-auto mb-6">
          <h2 className="text-3xl font-bold">Parametric modeling with kcl</h2>
          <p className="my-4">
            This example script shows how a code representation of your design
            makes easy work of tedious tasks in traditional CAD software, such
            as calculating a safety factor.
          </p>

          <p className="my-4">
            We've received this sketch from a designer highlighting an{' '}
            <em className="text-energy-60 dark:text-energy-20">
              aluminum bracket
            </em>{' '}
            they need for this shelf:
          </p>
          <figure className="my-4 w-2/3 mx-auto">
            <img
              src={`/onboarding-bracket${getImageTheme()}.png`}
              alt="Bracket"
            />
            <figcaption className="text-small italic text-center">
              A simplified shelf bracket
            </figcaption>
          </figure>
          <p className="my-4">
            We are able to easily calculate the thickness of the material based
            on the width of the bracket to meet a set safety factor on{' '}
            <em className="text-energy-60 dark:text-energy-20">line 6</em>.
          </p>
        </section>
        <OnboardingButtons
          currentSlug={onboardingPaths.PARAMETRIC_MODELING}
          dismiss={dismiss}
          next={next}
          nextText="Next: Interactive Numbers"
        />
      </div>
    </div>
  )
}
