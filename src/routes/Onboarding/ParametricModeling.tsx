import { OnboardingButtons, useDemoCode } from '.'
import { onboardingPaths } from 'routes/Onboarding/paths'
import { Themes, getSystemTheme } from 'lib/theme'
import { bracketThicknessCalculationLine } from 'lib/exampleKcl'
import { isDesktop } from 'lib/isDesktop'
import { useSettings } from 'machines/appMachine'

export default function OnboardingParametricModeling() {
  useDemoCode()
  const {
    app: {
      theme: { current: theme },
    },
  } = useSettings()
  const getImageTheme = () =>
    theme === Themes.Light ||
    (theme === Themes.System && getSystemTheme() === Themes.Light)
      ? '-dark'
      : ''

  return (
    <div className="fixed grid justify-end items-center inset-0 z-50 pointer-events-none">
      <div
        className={
          'relative pointer-events-auto z-10 max-w-xl border border-chalkboard-50 dark:border-chalkboard-80 shadow-lg h-[75vh] flex flex-col justify-center bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded'
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
            <em>
              <strong>aluminum bracket</strong>
            </em>{' '}
            they need for this shelf:
          </p>
          <figure className="my-4 w-2/3 mx-auto">
            <img
              src={`${
                isDesktop() ? '.' : ''
              }/onboarding-bracket${getImageTheme()}.png`}
              alt="Bracket"
            />
            <figcaption className="text-small italic text-center">
              A simplified shelf bracket
            </figcaption>
          </figure>
          <p className="my-4">
            We are able to easily calculate the thickness of the material based
            on the width of the bracket to meet a set safety factor on{' '}
            <em>
              <strong>line {bracketThicknessCalculationLine}</strong>
            </em>
            .
          </p>
          <figure className="my-4 w-2/3 mx-auto">
            <img
              src={`${
                isDesktop() ? '.' : ''
              }/onboarding-bracket-dimensions${getImageTheme()}.png`}
              alt="Bracket Dimensions"
            />
            <figcaption className="text-small italic text-center">
              Bracket Dimensions
            </figcaption>
          </figure>
        </section>
        <OnboardingButtons currentSlug={onboardingPaths.PARAMETRIC_MODELING} />
      </div>
    </div>
  )
}
