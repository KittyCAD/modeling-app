import { CommandCameraInput } from '@src/components/CommandBar/CommandCameraInput'
import type { KclManager } from '@src/lang/KclManager'
import { useApp } from '@src/lib/boot'
import type { CommandArgument } from '@src/lib/commandTypes'

function CommandBarCameraInput({
  arg,
  onSubmit,
  executingEditor,
}: {
  arg: CommandArgument<unknown> & { inputType: 'camera'; name: string }
  onSubmit: (value: unknown) => void
  executingEditor: KclManager
}) {
  const { commands } = useApp()
  const { argumentsToSubmit } = commands.useState().context

  return (
    <div className="p-4">
      <CommandCameraInput
        controls={executingEditor.sceneInfra.camControls}
        saved={Boolean(argumentsToSubmit[arg.name])}
        onChange={onSubmit}
      />
    </div>
  )
}

export default CommandBarCameraInput
