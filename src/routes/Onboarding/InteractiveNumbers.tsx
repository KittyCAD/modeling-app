import { faArrowRight, faXmark } from '@fortawesome/free-solid-svg-icons'
import { ActionButton } from '../../components/ActionButton'
import { onboardingPaths, useDismiss, useNextClick } from '.'
import { useStore } from '../../useStore'
import { useBackdropHighlight } from 'hooks/useBackdropHighlight'

export default function InteractiveNumbers() {
  const { buttonDownInStream } = useStore((s) => ({
    buttonDownInStream: s.buttonDownInStream,
  }))
  const dismiss = useDismiss()
  const next = useNextClick(onboardingPaths.SKETCHING)

  return (
    <div className="fixed grid justify-end items-center inset-0 z-50 pointer-events-none">
      <div
        className="fixed inset-0 bg-black opacity-50 pointer-events-none"
        style={{ clipPath: useBackdropHighlight('code-pane') }}
      ></div>
      <div
        className={
          'z-10 max-w-xl h-3/4 flex flex-col justify-center bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded' +
          (buttonDownInStream ? '' : ' pointer-events-auto')
        }
      >
        <section className="flex-1 overflow-y-auto mb-6">
          <h2 className="text-2xl">Interactive Numbers</h2>
          <p className="my-4">
            Let's do a little bit of hybrid editing to this part.
          </p>
          <p className="my-4">
            Try changing the value of <code>width</code> on line 3 by holding
            the <kbd>Alt</kbd> key and dragging the number left and right. You
            can hold down different modifier keys to change the value by
            different increments:
            <table className="border-collapse">
              <tbody>
                <tr>
                  <td>
                    <kbd>Alt + Shift + Cmd/Win</kbd>
                  </td>
                  <td>0.01</td>
                </tr>
                <tr>
                  <td>
                    <kbd>Alt + Cmd/Win</kbd>
                  </td>
                  <td>0.1</td>
                </tr>
                <tr>
                  <td>
                    <kbd>Alt</kbd>
                  </td>
                  <td>1</td>
                </tr>
                <tr>
                  <td>
                    <kbd>Alt + Shift</kbd>
                  </td>
                  <td>10</td>
                </tr>
              </tbody>
            </table>
          </p>
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
            Editing code should feel as interactive as point-and-click when you
            want it to be, so that you can work in the way that feels most
            natural to you. We're going to keep extending the text editor, and
            we'd love to hear your ideas for how to make it better.
          </p>
        </section>
        <div className="flex justify-between">
          <ActionButton
            Element="button"
            onClick={() => dismiss('../../')}
            icon={{
              icon: faXmark,
              bgClassName: 'bg-destroy-80',
              iconClassName:
                'text-destroy-20 group-hover:text-destroy-10 hover:text-destroy-10',
            }}
            className="hover:border-destroy-40"
          >
            Dismiss
          </ActionButton>
          <ActionButton
            Element="button"
            onClick={next}
            icon={{ icon: faArrowRight }}
          >
            Next: Sketching
          </ActionButton>
        </div>
      </div>
    </div>
  )
}
