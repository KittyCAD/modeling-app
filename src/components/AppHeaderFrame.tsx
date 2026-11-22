import { useSignals } from '@preact/signals-react/runtime'
import { useApp } from '@src/lib/boot'
import { isDesktop } from '@src/lib/isDesktop'
import {
  type AppHeaderContext,
  appHeaderStartItemsFacet,
  appHeaderEndItemsFacet,
} from '@src/registry/contracts/appHeader'
import type { CSSProperties } from 'react'

/** Shared chrome owns native window spacing; extensions own the two action zones. */
export function AppHeaderFrame({
  context,
  className = '',
  style,
  nativeFileMenuCreated = false,
}: {
  context: AppHeaderContext
  className?: string
  style?: CSSProperties
  nativeFileMenuCreated?: boolean
}) {
  useSignals()
  const app = useApp()
  const start = app.registry.observe(appHeaderStartItemsFacet).value
  const end = app.registry.observe(appHeaderEndItemsFacet).value
  const itemClassName =
    'relative inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-md border b-4 bg-2 px-1 text-default hover:bg-3 focus-visible:outline-appForeground active:border-primary disabled:cursor-default disabled:opacity-70'
  return (
    <header
      id="app-header"
      data-testid="app-header"
      data-native-file-menu={nativeFileMenuCreated}
      className={`sticky top-0 z-20 flex w-full shrink-0 select-none items-stretch justify-between gap-2 border-b b-4 bg-2 px-2 ${isDesktop() ? '[-webkit-app-region:drag]' : ''} ${window.electron?.os.isMac ? 'pl-24' : ''} ${className}`}
      style={style}
    >
      <div
        data-testid="app-header-start"
        className="flex min-w-0 items-stretch gap-2"
      >
        {start.map(({ id, Component }) => (
          <Component
            key={id}
            app={app}
            context={context}
            className={itemClassName}
          />
        ))}
      </div>
      <div
        data-testid="app-header-end"
        className="ml-auto flex shrink-0 items-center gap-2 py-1.5 [-webkit-app-region:no-drag]"
      >
        {end.map(({ id, Component }) => (
          <Component
            key={id}
            app={app}
            context={context}
            className={itemClassName}
          />
        ))}
      </div>
    </header>
  )
}
