import ReactDOM from 'react-dom/client'
import './index.css'
import reportWebVitals from './reportWebVitals'
import { Toaster } from 'react-hot-toast'
import { Router } from './Router'
import { HotkeysProvider } from 'react-hotkeys-hook'

// uncomment for xstate inspector
// import { DEV } from 'env'
// import { inspect } from '@xstate/inspect'
// if (DEV)
//   inspect({
//     iframe: false,
//   })

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement)

root.render(
  <HotkeysProvider>
    <Router />
    <Toaster
      position="bottom-center"
      toastOptions={{
        style: {
          borderRadius: '3px',
        },
        className:
          'bg-chalkboard-10 dark:bg-chalkboard-90 text-chalkboard-110 dark:text-chalkboard-10 rounded-sm border-chalkboard-20/50 dark:border-chalkboard-80/50',
        success: {
          iconTheme: {
            primary: 'oklch(89% 0.16 143.4deg)',
            secondary: 'oklch(48.62% 0.1654 142.5deg)',
          },
          duration: 1500,
        },
      }}
    />
  </HotkeysProvider>
)

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals()
