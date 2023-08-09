import ReactDOM from 'react-dom/client'
import './index.css'
import reportWebVitals from './reportWebVitals'
import { Toaster } from 'react-hot-toast'
import { Themes, useStore } from './useStore'
import { Router } from './Router'
import { HotkeysProvider } from 'react-hotkeys-hook'
import { getSystemTheme } from './lib/getSystemTheme'

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement)
function setThemeClass(state: Partial<{ theme: Themes }>) {
  const systemTheme = state.theme === Themes.System && getSystemTheme()
  if (state.theme === Themes.Dark || systemTheme === Themes.Dark) {
    document.body.classList.add('dark')
  } else {
    document.body.classList.remove('dark')
  }
}
const { theme } = useStore.getState()
setThemeClass({ theme })
useStore.subscribe(setThemeClass)

root.render(
  <HotkeysProvider>
    <Router />
    <Toaster
      position="bottom-center"
      toastOptions={{
        className:
          'bg-chalkboard-10 dark:bg-chalkboard-90 text-chalkboard-110 dark:text-chalkboard-10',
      }}
    />
  </HotkeysProvider>
)

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals()
