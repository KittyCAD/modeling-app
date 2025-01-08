import { getSystemTheme } from 'lib/theme'
import { ZOO_STUDIO_PROTOCOL } from 'lib/link'
import { useState } from 'react'
import {
  useCreateFileLinkQuery,
  CreateFileSchemaMethodOptional,
} from 'hooks/useCreateFileLinkQueryWatcher'
import { isDesktop } from 'lib/isDesktop'
import { Spinner } from './Spinner'

export const ProtocolHandler = (props: { children: ReactNode }) => {
  const [hasCustomProtocolScheme, setHasCustomProtocolScheme] = useState(false)
  const [hasAsked, setHasAsked] = useState(false)
  useCreateFileLinkQuery((args) => {
    if (hasAsked) return
    window.location.href = `zoo-studio:${JSON.stringify(args)}`
    setHasAsked(true)
    setHasCustomProtocolScheme(true)
  })

  const continueToWebApp = () => {
    setHasCustomProtocolScheme(false)
  }

  const pathLogomarkSvg = `${isDesktop() ? '.' : ''}/zma-logomark.svg`

  return hasCustomProtocolScheme ? (
    <div className="flex items-center justify-center h-full">
      <div
        style={{
          background: `url(${pathLogomarkSvg})`,
          backgroundRepeat: 'repeat',
          backgroundSize: '100%',
          transform: 'rotate(45deg)',
          filter: `brightness(${getSystemTheme() === 'light' ? 97 : 0}%)`,
          height: '100%',
          width: '100%',
          position: 'absolute',
        }}
        className="flex items-center justify-center h-full"
      ></div>
      <div
        className="flex items-center justify-center h-full"
        style={{ zIndex: 10 }}
      >
        <div className="p-4 mx-auto border rounded rounded-tl-none shadow-lg bg-chalkboard-10 dark:bg-chalkboard-100 dark:border-chalkboard-70">
          <div className="gap-4 flex flex-col items-center">
            <div>Launching</div>
            <img
              src={pathLogomarkSvg}
              style={{
                filter: `brightness(${getSystemTheme() === 'light' ? 10 : 0}%)`,
              }}
            />
            <Spinner />
            <button onClick={continueToWebApp}>Continue to web app</button>
          </div>
        </div>
      </div>
    </div>
  ) : (
    props.children
  )
}
