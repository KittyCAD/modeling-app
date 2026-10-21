import { resolveValue } from 'react-hot-toast'
import type { Toast } from 'react-hot-toast'
import { cloneElement } from 'react'
import { checkmarkIcon, closeIcon } from '@src/components/commonIcons'
import { Spinner } from '@src/components/Spinner'

export function AppToast({ toast }: { toast: Toast }) {
  if (!toast.visible) return null

  const iconType =
    toast.icon !== undefined
      ? 'custom'
      : toast.type === 'loading' ||
          toast.type === 'success' ||
          toast.type === 'error'
        ? toast.type
        : undefined
  const icon =
    toast.icon !== undefined ? (
      toast.icon
    ) : toast.type === 'loading' ? (
      <Spinner className="h-5 w-5" />
    ) : toast.type === 'success' || toast.type === 'error' ? (
      cloneElement(toast.type === 'success' ? checkmarkIcon : closeIcon, {
        className: 'h-5 w-5 rounded-full',
        style: {
          backgroundColor:
            toast.iconTheme?.primary ??
            (toast.type === 'success' ? '#61d345' : '#ff4b4b'),
          color: toast.iconTheme?.secondary ?? '#fff',
        },
      })
    ) : null

  return (
    <div
      className={`app-toast ${toast.className ?? ''}`}
      style={{ ...toast.style, display: 'flex' }}
      data-toast-id={toast.id}
      data-toast-type={toast.type}
      data-toast-visible={toast.visible}
    >
      {icon !== null && (
        <span
          className="flex min-w-5 shrink-0 items-center justify-center"
          data-toast-icon={iconType}
          aria-hidden="true"
        >
          {icon}
        </span>
      )}
      <div
        className="mx-2.5 my-1 flex-1 whitespace-pre-line"
        {...toast.ariaProps}
      >
        {resolveValue(toast.message, toast)}
      </div>
    </div>
  )
}
