import { useSearchParams } from 'react-router-dom'
import { useToken } from '@src/lib/singletons'
import env from '@src/env'
import { ConnectionStream } from '@src/components/ConnectionStream'
import Gizmo from '@src/components/Gizmo'
import { UnitsMenu } from '@src/components/UnitsMenu'
import { Toolbar } from '@src/Toolbar'

/**
 * For now we have strict area types but in future
 * we should make it possible to register your own in an extension.
 */
export const areaTypeRegistry = Object.freeze({
  modeling: ModelingArea,
  ttc: () => <TestArea name="Text-to-CAD" />,
  variables: () => <TestArea name="Variables" />,
  codeEditor: () => <TestArea name="Code Editor" />,
  featureTree: () => <TestArea name="Feature Tree" />,
  logs: () => <TestArea name="Logs" />,
})

function TestArea({ name }: { name: string }) {
  return (
    <div className="self-stretch flex-1 grid place-content-center">{name}</div>
  )
}
export const testAreaTypeRegistry = Object.freeze(
  Object.fromEntries(
    Object.keys(areaTypeRegistry).map((key) => [
      key,
      () => <TestArea name={key} />,
    ])
  )
)

function ModelingArea() {
  const authToken = useToken()

  // Stream related refs and data
  const [searchParams] = useSearchParams()
  const pool = searchParams?.get('pool') || env().POOL || null

  return (
    <div className="relative z-0 flex flex-col flex-1 items-center overflow-hidden">
      <Toolbar />
      <ConnectionStream pool={pool} authToken={authToken} />
      <div className="absolute bottom-2 right-2 flex flex-col items-end gap-3 pointer-events-none">
        <UnitsMenu />
        <Gizmo />
      </div>
    </div>
  )
}
