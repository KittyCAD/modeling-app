import { PanelHeader } from '../components/PanelHeader'
import { useStore } from '../useStore'
import { v4 as uuidv4 } from 'uuid'
import { EngineCommand } from '../lang/std/engineConnection'
import { useState } from 'react'
import { ActionButton } from '../components/ActionButton'
import { faCheck } from '@fortawesome/free-solid-svg-icons'

type SketchModeCmd = EngineCommand['cmd']['DefaultCameraEnableSketchMode']

export const DebugPanel = () => {
  const { engineCommandManager } = useStore((s) => ({
    engineCommandManager: s.engineCommandManager,
  }))
  const [sketchModeCmd, setSketchModeCmd] = useState<SketchModeCmd>({
    origin: { x: 0, y: 0, z: 0 },
    x_axis: { x: 1, y: 0, z: 0 },
    y_axis: { x: 0, y: 1, z: 0 },
    distance_to_plane: 100,
    ortho: true,
  })
  if (!sketchModeCmd) return null
  return (
    <div>
      <PanelHeader title="Debug" />
      <Xyz onChange={setSketchModeCmd} pointKey="origin" data={sketchModeCmd} />
      <Xyz onChange={setSketchModeCmd} pointKey="x_axis" data={sketchModeCmd} />
      <Xyz onChange={setSketchModeCmd} pointKey="y_axis" data={sketchModeCmd} />
      <div className="flex">
        <div className="pr-4">distance_to_plane</div>
        <input
          className="w-16"
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
          onChange={(a) => {
            console.log(a, (a as any).checked)
            setSketchModeCmd({
              ...sketchModeCmd,
              ortho: a.target.checked,
            })
          }}
        />
      </div>
      <ActionButton
        onClick={() => {
          engineCommandManager?.sendSceneCommand({
            type: 'ModelingCmdReq',
            cmd: {
              DefaultCameraEnableSketchMode: sketchModeCmd,
            },
            cmd_id: uuidv4(),
            file_id: uuidv4(),
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
    </div>
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
              className="w-16"
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
