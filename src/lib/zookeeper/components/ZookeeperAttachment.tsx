import { Dialog } from '@headlessui/react'
import type { MlCopilotFile } from '@kittycad/lib'
import { CustomIcon } from '@src/components/CustomIcon'
import { isTextFile } from '@src/lib/fileExtensions'
import { isImageMimetype, isTextMimetype } from '@src/lib/mimeTypes'
import type { ZookeeperAttachmentFetchState } from '@src/lib/zookeeper/zookeeperManagerMachine'
import { reportRejection } from '@src/lib/trap'
import { type ReactNode, useEffect, useRef, useState } from 'react'

type AttachmentFile = File | MlCopilotFile
const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024

export function ZookeeperAttachment({
  file,
  children,
  className,
  fetchState,
  onFetch,
}: {
  file: AttachmentFile
  children: ReactNode
  className: string
  fetchState?: ZookeeperAttachmentFetchState
  onFetch?: () => void
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  useEffect(() => {
    if (wasOpen.current && !open)
      triggerRef.current?.focus({ preventScroll: true })
    wasOpen.current = open
  }, [open])

  const mimetype = file instanceof File ? file.type : file.mimetype
  const isImage = isImageMimetype(mimetype)
  const canPreview =
    isImage || isTextMimetype(mimetype) || isTextFile(file.name)
  const needsFetch =
    !(file instanceof File) &&
    file.data.length === 0 &&
    file.attachment_ref !== undefined &&
    fetchState?.status !== 'loaded'
  const canFetch = needsFetch && onFetch !== undefined
  const previewFile = fetchState?.status === 'loaded' ? fetchState.file : file

  return (
    <>
      {canPreview || canFetch ? (
        <button
          ref={triggerRef}
          type="button"
          className={className}
          aria-haspopup={canPreview ? 'dialog' : undefined}
          disabled={!canPreview && fetchState?.status === 'loading'}
          onClick={() => {
            if (canPreview) setOpen(true)
            if (canFetch && fetchState?.status !== 'loading') onFetch()
          }}
        >
          {children}
        </button>
      ) : (
        <div className={className}>{children}</div>
      )}
      {open && (
        <Dialog
          open={true}
          onClose={() => setOpen(false)}
          className="fixed inset-0 z-50 overflow-y-auto p-4"
        >
          <Dialog.Overlay className="fixed inset-0 bg-chalkboard-10/80 dark:bg-chalkboard-110/60" />
          <div className="relative flex min-h-full items-center justify-center">
            <Dialog.Panel className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded border border-chalkboard-30 bg-chalkboard-10 shadow-lg dark:border-chalkboard-70 dark:bg-chalkboard-100">
              <div className="flex items-center justify-between gap-4 border-b border-chalkboard-20 p-4 dark:border-chalkboard-70">
                <Dialog.Title as="h2" className="text-lg font-bold">
                  {isImage ? 'Image preview' : 'Text preview'}
                </Dialog.Title>
                <button
                  type="button"
                  className="group m-0 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border-none bg-transparent p-0 hover:bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-appForeground"
                  aria-label="Close preview"
                  onClick={() => setOpen(false)}
                >
                  <CustomIcon
                    name="close"
                    className="w-5 h-5 rounded-sm bg-chalkboard-20 text-chalkboard-80 dark:bg-chalkboard-80 dark:text-chalkboard-20 group-hover:brightness-110"
                  />
                </button>
              </div>
              <div className="min-h-0 overflow-auto p-4">
                {needsFetch ? (
                  <>
                    {fetchState?.status === 'error' ? (
                      <p role="alert">{fetchState.message}</p>
                    ) : (
                      <p role="status">
                        {fetchState?.status === 'loading'
                          ? 'Loading attachment…'
                          : 'Attachment has not been loaded.'}
                      </p>
                    )}
                    {canFetch && fetchState?.status !== 'loading' && (
                      <button type="button" onClick={onFetch}>
                        {fetchState?.status === 'error'
                          ? 'Retry'
                          : 'Load attachment'}
                      </button>
                    )}
                  </>
                ) : (
                  <AttachmentContents file={previewFile} isImage={isImage} />
                )}
              </div>
            </Dialog.Panel>
          </div>
        </Dialog>
      )}
    </>
  )
}

function AttachmentContents({
  file,
  isImage,
}: {
  file: AttachmentFile
  isImage: boolean
}) {
  const textTooLarge =
    !isImage &&
    (file instanceof File ? file.size : file.data.length) >
      MAX_TEXT_PREVIEW_BYTES
  const [preview, setPreview] = useState<{
    file: AttachmentFile
    content?: string
    failed?: boolean
  }>()

  useEffect(() => {
    if (textTooLarge) return
    const blob =
      file instanceof File
        ? file
        : new Blob([new Uint8Array(file.data)], { type: file.mimetype })
    if (isImage) {
      const url = URL.createObjectURL(blob)
      setPreview({ file, content: url })
      return () => URL.revokeObjectURL(url)
    }

    let active = true
    blob.text().then(
      (content) => {
        if (active) setPreview({ file, content })
      },
      (error: unknown) => {
        reportRejection(error)
        if (active) setPreview({ file, failed: true })
      }
    )
    return () => {
      active = false
    }
  }, [file, isImage, textTooLarge])

  if (textTooLarge) {
    return <p role="alert">Text files larger than 1 MiB cannot be previewed.</p>
  }
  if (preview?.file !== file) return <p role="status">Loading preview…</p>
  if (preview.failed) {
    return <p role="alert">Could not preview this attachment.</p>
  }
  return isImage ? (
    <img
      src={preview.content}
      alt="Attachment preview"
      className="mx-auto max-h-[70vh] max-w-full object-contain"
      onError={() =>
        setPreview((current) =>
          current === preview ? { file, failed: true } : current
        )
      }
    />
  ) : (
    <pre className="m-0 whitespace-pre-wrap break-words font-mono text-sm">
      {preview.content}
    </pre>
  )
}
