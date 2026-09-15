import Loading from '@src/components/Loading'
import { PATHS } from '@src/lib/paths'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { matchRoutes, useNavigation, useParams } from 'react-router-dom'

const fileRoutes = [{ path: `${PATHS.FILE}/:id/*` }]

/** Keep the shared editor mounted, but do not present a pending file as active. */
export function PendingFileNavigation({ children }: { children: ReactNode }) {
  const navigation = useNavigation()
  const { id } = useParams()
  const [wasSwitchingFile, setWasSwitchingFile] = useState(false)
  const destination = navigation.location
    ? matchRoutes(fileRoutes, navigation.location)?.[0]
    : undefined
  const isSwitchingFile =
    navigation.state !== 'idle' &&
    (wasSwitchingFile ||
      (destination !== undefined && destination.params.id !== id))

  // Returning to the committed route can still be restoring its editor.
  // Keep the view hidden across superseding loads until navigation settles.
  if (wasSwitchingFile !== isSwitchingFile) {
    setWasSwitchingFile(isSwitchingFile)
  }

  // fileLoader updates the singleton editor before awaiting execution. History
  // still points at the previous file until the router commits that loader.
  // Preserve layout and mounted effects while keeping this intermediate state
  // out of view and out of the tab order.
  return (
    <>
      <div
        style={{ visibility: isSwitchingFile ? 'hidden' : undefined }}
        inert={isSwitchingFile}
        aria-hidden={isSwitchingFile || undefined}
      >
        {children}
      </div>
      {isSwitchingFile && (
        <div
          className="absolute inset-0 grid place-content-center"
          role="status"
        >
          <Loading isDummy>Loading file...</Loading>
        </div>
      )}
    </>
  )
}
