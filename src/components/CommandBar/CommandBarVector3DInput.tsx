import { useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { commandBarActor } from '@src/lib/singletons'
import type { CommandArgument } from '@src/lib/commandTypes'

function CommandBarVector3DInput({
  arg,
  stepBack,
  onSubmit,
}: {
  arg: CommandArgument<unknown> & {
    inputType: 'vector3d'
    name: string
  }
  stepBack: () => void
  onSubmit: (data: [number, number, number]) => void
}) {
  const [x, setX] = useState('')
  const [y, setY] = useState('')
  const [z, setZ] = useState('')

  const xInputRef = useRef<HTMLInputElement>(null)
  const yInputRef = useRef<HTMLInputElement>(null)
  const zInputRef = useRef<HTMLInputElement>(null)

  useHotkeys('mod + k, mod + /', () => commandBarActor.send({ type: 'Close' }))

  // Focus the first input on mount
  useEffect(() => {
    if (xInputRef.current) {
      xInputRef.current.focus()
    }
  }, [])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    const xNum = parseFloat(x)
    const yNum = parseFloat(y)
    const zNum = parseFloat(z)

    // Basic validation - ensure all values are valid numbers
    if (Number.isNaN(xNum) || Number.isNaN(yNum) || Number.isNaN(zNum)) {
      return // Don't submit if any value is invalid
    }

    onSubmit([xNum, yNum, zNum])
  }

  function handleKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    nextInputRef?: React.RefObject<HTMLInputElement>
  ) {
    if (e.metaKey && e.key === 'k') {
      commandBarActor.send({ type: 'Close' })
    }
    if (e.key === 'Backspace' && e.metaKey) {
      stepBack()
    }
    // Move to next input on Tab or Enter
    if ((e.key === 'Tab' || e.key === 'Enter') && nextInputRef?.current) {
      e.preventDefault()
      nextInputRef.current.focus()
    }
  }

  return (
    <div className="w-full">
      <form
        id="vector3d-form"
        data-testid="vector3d-form"
        onSubmit={handleSubmit}
      >
        <div className="flex items-center mx-4 mt-4 mb-2">
          <span className="capitalize px-2 py-1 rounded-l bg-chalkboard-100 dark:bg-chalkboard-80 text-chalkboard-10 border-b border-b-chalkboard-100 dark:border-b-chalkboard-80">
            {arg.displayName || arg.name}
          </span>
          <div className="flex flex-1">
            <input
              ref={xInputRef}
              data-testid="vector3d-x-input"
              type="number"
              step="any"
              placeholder="X"
              value={x}
              onChange={(e) => setX(e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, yInputRef)}
              className="flex-1 px-2 py-1 bg-transparent border-b border-b-chalkboard-100 dark:border-b-chalkboard-80 focus:outline-none text-center"
            />
            <input
              ref={yInputRef}
              data-testid="vector3d-y-input"
              type="number"
              step="any"
              placeholder="Y"
              value={y}
              onChange={(e) => setY(e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, zInputRef)}
              className="flex-1 px-2 py-1 bg-transparent border-b border-b-chalkboard-100 dark:border-b-chalkboard-80 focus:outline-none text-center border-l border-l-chalkboard-100 dark:border-l-chalkboard-80"
            />
            <input
              ref={zInputRef}
              data-testid="vector3d-z-input"
              type="number"
              step="any"
              placeholder="Z"
              value={z}
              onChange={(e) => setZ(e.target.value)}
              onKeyDown={(e) => handleKeyDown(e)}
              className="flex-1 px-2 py-1 bg-transparent border-b border-b-chalkboard-100 dark:border-b-chalkboard-80 focus:outline-none text-center border-l border-l-chalkboard-100 dark:border-l-chalkboard-80"
            />
          </div>
        </div>
        <p className="mx-4 mb-4 text-sm text-chalkboard-70 dark:text-chalkboard-40">
          Enter X, Y, Z coordinates for the 3D vector
        </p>
      </form>
    </div>
  )
}

export default CommandBarVector3DInput
