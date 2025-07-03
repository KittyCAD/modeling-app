import React from 'react'
import { useKclContext } from '@src/lang/KclProvider'
import { Toggle } from '@src/components/Toggle/Toggle'

const TOGGLE_NAME = "pause-kcl-execution-toggle"

export function PauseKclExecutionButton() {
  const { isPaused, togglePause } = useKclContext()

  // stop the live update of the kcl code
  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
  }

  const handleChange = () => {
    togglePause()
  }

  return (
    <div 
      className="flex items-center justify-between w-full px-2"
      onClick={handleClick} // Stop propagation here
      role="presentation"
    >
      <label htmlFor={TOGGLE_NAME} className="text-sm mr-2 cursor-pointer flex-grow">
        Pause KCL Execution
      </label>
      <Toggle
        name={TOGGLE_NAME}
        checked={isPaused}
        onChange={handleChange}
      />
    </div>
  )
}