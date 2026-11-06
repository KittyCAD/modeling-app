import { Dialog } from '@headlessui/react'
import { useRef, useState } from 'react'

export const ZookeeperImagePreview = ({
  url,
  name,
}: {
  url: string
  name: string
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [imageError, setImageError] = useState(false)
  const closeButton = useRef<HTMLButtonElement>(null)
  const previewButton = useRef<HTMLButtonElement>(null)
  const close = () => {
    setIsOpen(false)
    requestAnimationFrame(() => previewButton.current?.focus())
  }

  return (
    <div className="flex min-w-0 max-w-full flex-col gap-1">
      <span className="truncate text-xs" title={name}>
        {name}
      </span>
      {imageError ? (
        <span className="text-xs">Image preview unavailable</span>
      ) : (
        <button
          ref={previewButton}
          type="button"
          aria-label={`View ${name}`}
          className="w-fit max-w-full overflow-hidden rounded border border-chalkboard-30 dark:border-chalkboard-70"
          onClick={() => setIsOpen(true)}
        >
          <img
            src={url}
            alt={name}
            className="block max-h-48 max-w-full object-contain"
            onError={() => setImageError(true)}
          />
        </button>
      )}
      <a href={url} download={name} className="text-xs underline">
        Download {name}
      </a>
      <Dialog
        open={isOpen}
        onClose={close}
        initialFocus={closeButton}
        className="fixed inset-0 z-50"
      >
        <Dialog.Overlay className="fixed inset-0 bg-black/70" />
        <div className="pointer-events-none fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="pointer-events-auto flex max-h-full max-w-full flex-col gap-2 rounded bg-2 p-4 text-default">
            <div className="flex items-center justify-between gap-4">
              <Dialog.Title className="min-w-0 break-words text-sm">
                {name}
              </Dialog.Title>
              <button ref={closeButton} type="button" onClick={close}>
                Close
              </button>
            </div>
            <div className="min-h-0 overflow-auto">
              <img src={url} alt={name} className="max-w-none" />
            </div>
            <a href={url} download={name} className="text-sm underline">
              Download {name}
            </a>
          </Dialog.Panel>
        </div>
      </Dialog>
    </div>
  )
}
