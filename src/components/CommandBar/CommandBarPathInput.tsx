import { useMemo, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

import type { CommandArgument } from '@src/lib/commandTypes'
import { commandBarActor } from '@src/lib/singletons'

function CommandBarPathInput({
  arg,
  stepBack,
  onSubmit,
}: {
  arg: CommandArgument<unknown> & {
    inputType: 'path'
    name: string
  }
  stepBack: () => void
  onSubmit: (event: unknown) => void
}) {
  useHotkeys('mod + k, mod + /', () => commandBarActor.send({ type: 'Close' }))
  const [files, setFiles] = useState<FileList | null>(null)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    onSubmit(files)
  }

  const styleHide = useMemo(() => ({ display: 'none' }), [])

  return (
    <form id="arg-form" onSubmit={handleSubmit}>
      <label
        data-testid="cmd-bar-arg-name"
        className="flex items-center mx-4 my-4 border-b border-b-chalkboard-100 dark:border-b-chalkboard-80"
      >
        <span className="capitalize px-2 py-1 bg-chalkboard-100 dark:bg-chalkboard-80 text-chalkboard-10">
          {arg.displayName || arg.name}
        </span>
        <input
          type="file"
          id="command-bar-import-file-picker"
          style={styleHide}
          onChange={(e) => setFiles(e.target.files)}
        />
        <div className="grow pl-2">{files?.[0].name}</div>
        <label
          className="leading-[0.7] group text-xs leading-none flex items-center gap-2 rounded-sm border-solid border border-chalkboard-30 hover:border-chalkboard-40 enabled:dark:border-chalkboard-70 dark:hover:border-chalkboard-60 dark:bg-chalkboard-90/50 text-chalkboard-100 dark:text-chalkboard-10 pl-2 pr-2 pt-1 pb-1 w-fit rounded-sm hover:brightness-110 hover:shadow focus:outline-current bg-chalkboard-20/50 dark:bg-chalkboard-80/50 border-chalkboard-20 dark:border-chalkboard-80bg-chalkboard-20/50 dark:bg-chalkboard-80/50 border-chalkboard-20 dark:border-chalkboard-80 cursor-pointer"
          data-testid="cmd-bar-arg-file-button"
          htmlFor="command-bar-import-file-picker"
        >
          {files !== null ? 'Change file' : 'Select file'}
        </label>
      </label>
    </form>
  )
}

export default CommandBarPathInput
