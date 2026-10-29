import { Toaster } from 'react-hot-toast'
import { AppToast } from '@src/components/AppToast'

export function AppToaster() {
  return (
    <Toaster
      position="bottom-center"
      containerClassName="app-toaster"
      toastOptions={{
        style: {
          borderRadius: '3px',
          maxInlineSize: 'min(480px, 100%)',
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
    >
      {(toast) => <AppToast toast={toast} />}
    </Toaster>
  )
}
