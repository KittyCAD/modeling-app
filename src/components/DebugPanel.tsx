import { CollapsiblePanel, CollapsiblePanelProps } from './CollapsiblePanel'
import { useStore } from '../useStore'
import { v4 as uuidv4 } from 'uuid'
import { EngineCommand } from '../lang/std/engineConnection'
import { useState } from 'react'
import { ActionButton } from '../components/ActionButton'
import { faCheck } from '@fortawesome/free-solid-svg-icons'
import { isReducedMotion } from 'lang/util'
import { AstExplorer } from './AstExplorer'

type SketchModeCmd = Extract<
  Extract<EngineCommand, { type: 'modeling_cmd_req' }>['cmd'],
  { type: 'default_camera_enable_sketch_mode' }
>

export const DebugPanel = ({ className, ...props }: CollapsiblePanelProps) => {
  const { engineCommandManager } = useStore((s) => ({
    engineCommandManager: s.engineCommandManager,
  }))
  const [sketchModeCmd, setSketchModeCmd] = useState<SketchModeCmd>({
    type: 'default_camera_enable_sketch_mode',
    origin: { x: 0, y: 0, z: 0 },
    x_axis: { x: 1, y: 0, z: 0 },
    y_axis: { x: 0, y: 1, z: 0 },
    distance_to_plane: 100,
    ortho: true,
    animated: !isReducedMotion(),
  })
  if (!sketchModeCmd) return null
  return (
    <CollapsiblePanel
      {...props}
      className={
        '!absolute overflow-hidden !h-auto bottom-5 right-5 ' + className
      }
      // header height, top-5, and bottom-5
      style={{ maxHeight: 'calc(100% - 3rem - 1.25rem - 1.25rem)' }}
    >
      <section className="p-4 flex flex-col gap-4">
        <Xyz
          onChange={setSketchModeCmd}
          pointKey="origin"
          data={sketchModeCmd}
        />
        <Xyz
          onChange={setSketchModeCmd}
          pointKey="x_axis"
          data={sketchModeCmd}
        />
        <Xyz
          onChange={setSketchModeCmd}
          pointKey="y_axis"
          data={sketchModeCmd}
        />
        <div className="flex">
          <div className="pr-4">distance_to_plane</div>
          <input
            className="w-16 dark:bg-chalkboard-90"
            type="number"
            value={sketchModeCmd.distance_to_plane}
            onChange={({ target }) => {
              setSketchModeCmd({
                ...sketchModeCmd,
                distance_to_plane: Number(target.value),
              })
            }}
          />
          <div className="pr-4">ortho</div>
          <input
            className="w-16"
            type="checkbox"
            checked={sketchModeCmd.ortho}
            onChange={(a) =>
              setSketchModeCmd({
                ...sketchModeCmd,
                ortho: a.target.checked,
              })
            }
          />
        </div>
        <ActionButton
          Element="button"
          onClick={() => {
            engineCommandManager?.sendSceneCommand({
              type: 'modeling_cmd_req',
              cmd: sketchModeCmd,
              cmd_id: uuidv4(),
            })
          }}
          className="hover:border-succeed-50"
          icon={{
            icon: faCheck,
            bgClassName:
              'bg-succeed-80 group-hover:bg-succeed-70 hover:bg-succeed-70',
            iconClassName:
              'text-succeed-20 group-hover:text-succeed-10 hover:text-succeed-10',
          }}
        >
          Send sketch mode command
        </ActionButton>
        <div style={{ height: '400px' }} className="overflow-y-auto">
          <AstExplorer />
        </div>
      </section>
    </CollapsiblePanel>
  )
}

const Xyz = ({
  pointKey,
  data,
  onChange,
}: {
  pointKey: 'origin' | 'y_axis' | 'x_axis'
  data: SketchModeCmd
  onChange: (a: SketchModeCmd) => void
}) => {
  if (!data) return null
  return (
    <div className="flex">
      <div className="pr-4">{pointKey}</div>
      {Object.entries(data[pointKey]).map(([axis, val]) => {
        return (
          <div key={axis} className="flex">
            <div className="w-4">{axis}</div>
            <input
              className="w-16 dark:bg-chalkboard-90"
              type="number"
              value={val}
              onChange={({ target }) => {
                onChange({
                  ...data,
                  [pointKey]: {
                    ...data[pointKey],
                    [axis]: Number(target.value),
                  },
                })
              }}
            />
          </div>
        )
      })}
    </div>
  )
}
