import { OnboardingButtons, kbdClasses, useDemoCode } from '.'
import { onboardingPaths } from 'routes/Onboarding/paths'
import { bracketWidthConstantLine } from 'lib/exampleKcl'

export default function OnboardingInteractiveNumbers() {
  useDemoCode()

  return (
    <div className="fixed grid justify-end items-center inset-0 z-50 pointer-events-none">
      <div
        className={
          'relative pointer-events-auto z-10 max-w-xl border border-chalkboard-50 dark:border-chalkboard-80 shadow-lg h-[75vh] flex flex-col justify-center bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded'
        }
      >
        <section className="flex-1 overflow-y-auto mb-6">
          <h2 className="text-3xl font-bold">Hybrid editing</h2>

          <p className="my-4">
            We believe editing in Design Studio should feel fluid between code
            and point-and-click, so that you can work in the way that feels most
            natural to you. Let's try something out that demonstrates this
            principle, by editing numbers without typing.
          </p>
          <ol className="pl-6 my-4 list-decimal">
            <li className="list-decimal">
              Press and hold the <kbd className={kbdClasses}>Alt</kbd> (or{' '}
              <kbd className={kbdClasses}>Option</kbd>) key
            </li>
            <li>
              Hover over the number assigned to "width" on{' '}
              <em>
                <strong>line {bracketWidthConstantLine}</strong>
              </em>
            </li>
            <li>Drag the number left and right to change its value</li>
          </ol>
          <p className="my-4">
            You can hold down different modifier keys to change the value by
            different increments:
          </p>
          <ul className="flex flex-col text-sm my-4 mx-12 divide-y divide-chalkboard-20 dark:divide-chalkboard-70">
            <li className="flex justify-between m-0 px-0 py-2">
              <kbd className={kbdClasses}>Alt + Shift + Cmd/Win</kbd>
              ±0.01
            </li>
            <li className="flex justify-between m-0 px-0 py-2">
              <kbd className={kbdClasses}>Alt + Cmd/Win</kbd>
              ±0.1
            </li>
            <li className="flex justify-between m-0 px-0 py-2">
              <kbd className={kbdClasses}>Alt</kbd>±1
            </li>
            <li className="flex justify-between m-0 px-0 py-2">
              <kbd className={kbdClasses}>Alt + Shift</kbd>
              ±10
            </li>
          </ul>
          <p className="my-4">
            Our code editor is built with{' '}
            <a
              href="https://codemirror.net/"
              target="_blank"
              rel="noreferrer noopeneer"
            >
              CodeMirror
            </a>
            , a great open-source project with extensions that make it even more
            dynamic and interactive, including{' '}
            <a
              href="https://github.com/replit/codemirror-interact/"
              target="_blank"
              rel="noreferrer noopeneer"
            >
              one by the Replit team
            </a>{' '}
            lets you interact with numbers in your code by dragging them around.
          </p>
          <p className="my-4">
            We're going to keep extending the text editor, and we'd love to hear
            your ideas for how to make it better.
          </p>
        </section>
        <OnboardingButtons currentSlug={onboardingPaths.INTERACTIVE_NUMBERS} />
      </div>
    </div>
  )
}
