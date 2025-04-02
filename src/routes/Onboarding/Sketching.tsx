import { useEffect } from 'react'

import { codeManager, kclManager } from '@src/lib/singletons'
import { onboardingPaths } from '@src/routes/Onboarding/paths'

import { OnboardingButtons } from '@src/routes/Onboarding/utils'

export default function Sketching() {
  useEffect(() => {
    async function clearEditor() {
      // We do want to update both the state and editor here.
      codeManager.updateCodeStateEditor('')
      await kclManager.executeCode(true)
    }

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    clearEditor()
  }, [])

  return (
    <div className="fixed grid justify-center items-end inset-0 z-50 pointer-events-none">
      <div
        className={
          'relative pointer-events-auto max-w-full xl:max-w-2xl border border-chalkboard-50 dark:border-chalkboard-80 shadow-lg flex flex-col justify-center bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded'
        }
      >
        <h1 className="text-2xl font-bold">Sketching</h1>
        <p className="my-4">
          Our 3D modeling tools are still very much a work in progress, but we
          want to show you some early features. Try sketching by clicking Start
          Sketch in the top toolbar and selecting a plane to draw on. Now you
          can start clicking to draw lines and shapes.
        </p>
        <p className="my-4">
          The Line tool will be equipped by default, but you can switch it to as
          you go by clicking another tool in the toolbar, or unequip it by
          clicking the Line tool button. With no tool selected, you can move
          points and add constraints to your sketch.
        </p>
        <p className="my-4">
          Watch the code pane as you click. Point-and-click interactions are
          always just modifying and generating code in Zoo Modeling App.
        </p>
        <OnboardingButtons
          currentSlug={onboardingPaths.SKETCHING}
          className="mt-6"
        />
      </div>
    </div>
  )
}
