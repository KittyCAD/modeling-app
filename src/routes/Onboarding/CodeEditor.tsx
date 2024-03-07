import { OnboardingButtons, useDismiss, useNextClick } from '.'
import { onboardingPaths } from 'routes/Onboarding/paths'
import { useStore } from '../../useStore'
import { useBackdropHighlight } from 'hooks/useBackdropHighlight'

export default function CodeEditor() {
  const { buttonDownInStream } = useStore((s) => ({
    buttonDownInStream: s.buttonDownInStream,
  }))
  const dismiss = useDismiss()
  const next = useNextClick(onboardingPaths.PARAMETRIC_MODELING)

  return (
    <div className="fixed grid justify-end items-center inset-0 z-50 pointer-events-none">
      <div
        className="fixed inset-0 bg-black opacity-50 dark:opacity-80 pointer-events-none"
        style={{ clipPath: useBackdropHighlight('code-pane') }}
      ></div>
      <div
        className={
          'z-10 max-w-xl border border-chalkboard-50 dark:border-chalkboard-80 shadow-lg h-3/4 flex flex-col justify-center bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded' +
          (buttonDownInStream ? '' : ' pointer-events-auto')
        }
      >
        <section className="flex-1">
          <h2 className="text-3xl font-bold">
            Editing code with{' '}
            <span className="text-energy-60 dark:text-energy-20">kcl</span>
          </h2>
          <p className="my-4">
            kcl is our language for describing geometry. Building our own
            language is difficult, but we chose to do it to have a language
            honed for spatial relationships and geometric computation. It'll
            always be open-source, and we hope it can grow into a new standard
            for describing parametric objects.
          </p>
          <p className="my-4">
            The left pane is where you write your code. It's a code editor with
            syntax highlighting and autocompletion for kcl. New features arrive
            in kcl before they're available as point-and-click tools, so it's
            good to have a link to{' '}
            <a
              href="https://github.com/KittyCAD/modeling-app/blob/main/docs/kcl/std.md"
              rel="noreferrer noopener"
              target="_blank"
            >
              our kcl docs
            </a>{' '}
            handy while you design for now. It's also available in the menu in
            the corner of the code pane.
          </p>
          <p className="my-4">
            We've built a{' '}
            <a
              href="https://github.com/KittyCAD/kcl-lsp"
              rel="noreferrer noopener"
              target="_blank"
            >
              language server
            </a>{' '}
            for kcl that provides documentation and autocompletion automatically
            generated from our compiler code. You can try it out by hovering
            over some of the function names in the pane now. If you like using
            VSCode, you can try out our{' '}
            <a
              href="https://marketplace.visualstudio.com/items?itemName=KittyCAD.kcl-language-server"
              rel="noreferrer noopener"
              target="_blank"
            >
              VSCode extension
            </a>
            .
          </p>
          <p className="my-4">
            You can resize the pane by dragging the handle on the right, and you
            can collapse it by clicking the title bar or pressing{' '}
            <kbd>Shift</kbd> + <kbd>C</kbd>.
          </p>
        </section>
        <OnboardingButtons
          currentSlug={onboardingPaths.EDITOR}
          dismiss={dismiss}
          next={next}
          nextText="Next: Parametric Modeling"
        />
      </div>
    </div>
  )
}
