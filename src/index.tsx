import { createRoot } from 'react-dom/client'
import { AppToaster } from '@src/components/AppToaster'
import { OpenInDesktopApp } from '@src/components/OpenInDesktopApp'
import {
  readDesktopHandoffTheme,
  shouldShowDesktopHandoff,
} from '@src/lib/browserHandoff'
import { ASK_TO_OPEN_QUERY_PARAM } from '@src/lib/constants'
import { isDesktop } from '@src/lib/isDesktop'
import {
  darkModeMatcher,
  getResolvedTheme,
  setThemeClass,
  Themes,
} from '@src/lib/theme'
import { reportRejection } from '@src/lib/trap'
import '@src/index.css'

const container = document.getElementById('root')
if (!container) {
  console.error('Unable to mount Design Studio: root element is missing.')
} else {
  const root = createRoot(container)
  if (shouldShowDesktopHandoff(location.search, isDesktop())) {
    let theme = Themes.System
    const applyTheme = () => setThemeClass(getResolvedTheme(theme))
    const onSystemThemeChange = () => {
      if (theme === Themes.System) applyTheme()
    }
    applyTheme()
    darkModeMatcher?.addEventListener('change', onSystemThemeChange)
    // Appearance is optional and must not delay the chooser's first paint.
    void readDesktopHandoffTheme().then((storedTheme) => {
      if (storedTheme === undefined) return
      theme = storedTheme
      applyTheme()
    })
    root.render(
      <>
        <OpenInDesktopApp
          onContinue={() => {
            const next = new URL(location.href)
            next.searchParams.delete(ASK_TO_OPEN_QUERY_PARAM)
            // Load the full app only in the destination document, after the
            // choice. Failed network navigation remains browser-owned.
            location.assign(next)
          }}
        />
        <AppToaster />
      </>
    )
  } else {
    void import('@src/launchApp')
      .then(({ launchApp }) => launchApp(root))
      .catch(reportRejection)
  }
}
