import type { ButtonHTMLAttributes } from 'react'

export interface CopyTextButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  textToCopy: string
  onCopySuccess?: (copiedText: string) => void
  onCopyError?: (error: unknown) => void
}

/**
 * Renders a button that writes a provided string to the user's clipboard.
 * The parent owns visual styling and copy/error feedback so this can be reused
 * in app-specific surfaces without pulling those concerns into ui-components.
 */
export function CopyTextButton({
  textToCopy,
  onCopySuccess,
  onCopyError,
  onClick,
  children,
  ...props
}: CopyTextButtonProps) {
  return (
    <button
      {...props}
      type="button"
      onClick={(event) => {
        onClick?.(event)

        if (event.defaultPrevented) {
          return
        }

        void copyTextToClipboard(textToCopy)
          .then(() => onCopySuccess?.(textToCopy))
          .catch((error: unknown) => onCopyError?.(error))
      }}
    >
      {children}
    </button>
  )
}

function copyTextToClipboard(textToCopy: string) {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    return Promise.reject(new Error('Clipboard API is not available.'))
  }

  return navigator.clipboard.writeText(textToCopy)
}
