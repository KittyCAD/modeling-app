import { Dialog } from '@headlessui/react'
import type { MlCopilotFile } from '@kittycad/lib'
import { ActionIcon } from '@src/components/ActionIcon'
import { MAX_TEXT_FILE_BYTES } from '@src/lib/constants'
import { isImageMimetype } from '@src/lib/mimeTypes'
import { decodeTextFile } from '@src/lib/textFiles'
import type { ZookeeperAttachmentFetchState } from '@src/lib/zookeeper/zookeeperManagerMachine'
import { isErr, reportRejection } from '@src/lib/trap'
import { type ReactNode, useEffect, useRef, useState } from 'react'

type AttachmentFile = File | MlCopilotFile

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
  const needsFetch =
    !(file instanceof File) &&
    file.data.length === 0 &&
    file.attachment_ref !== undefined &&
    fetchState?.status !== 'loaded'
  const canFetch = needsFetch && onFetch !== undefined
  const previewFile = fetchState?.status === 'loaded' ? fetchState.file : file

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true)
          if (canFetch && fetchState?.status !== 'loading') onFetch()
        }}
      >
        {children}
      </button>
      {open && (
        <Dialog
          open={true}
          onClose={() => setOpen(false)}
          className="fixed inset-0 z-50 overflow-y-auto p-4"
        >
          <Dialog.Overlay className="fixed inset-0 bg-1/80" />
          <div className="relative flex min-h-full items-center justify-center">
            <Dialog.Panel className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded border b-4 bg-1 shadow-lg">
              <div className="flex items-center justify-between gap-4 border-b b-3 p-4">
                <Dialog.Title as="h2" className="text-lg font-bold">
                  {isImage ? 'Image preview' : 'Text preview'}
                </Dialog.Title>
                <button
                  type="button"
                  className="group m-0 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border-none bg-transparent p-0 hover:bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-color-4"
                  aria-label="Close preview"
                  onClick={() => setOpen(false)}
                >
                  <ActionIcon
                    icon="close"
                    className="!self-center rounded-sm text-2 group-hover:brightness-110"
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
    (file instanceof File ? file.size : file.data.length) > MAX_TEXT_FILE_BYTES
  const [preview, setPreview] = useState<{
    file: AttachmentFile
    content?: string
    error?: string
    actualSize?: boolean
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
    blob.arrayBuffer().then(
      (bytes) => {
        if (!active) return
        const content = decodeTextFile(bytes)
        setPreview(
          isErr(content) ? { file, error: content.message } : { file, content }
        )
      },
      (error: unknown) => {
        reportRejection(error)
        if (active)
          setPreview({ file, error: 'Could not preview this attachment.' })
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
  if (preview.error) {
    return <p role="alert">{preview.error}</p>
  }
  return isImage ? (
    <div className="flex min-w-0 flex-col gap-3">
      <button
        type="button"
        className="self-end rounded border b-4 px-3 py-1 text-sm hover:bg-2"
        aria-pressed={Boolean(preview.actualSize)}
        onClick={() =>
          setPreview((current) =>
            current === preview
              ? { ...current, actualSize: !current.actualSize }
              : current
          )
        }
      >
        {preview.actualSize ? 'Fit to window' : 'View actual size'}
      </button>
      <div className="max-h-[70vh] overflow-auto">
        <img
          src={preview.content}
          alt="Attachment preview"
          className={
            preview.actualSize
              ? 'mx-auto max-w-none'
              : 'mx-auto max-h-[70vh] max-w-full object-contain'
          }
          onError={() =>
            setPreview((current) =>
              current === preview
                ? { file, error: 'Could not preview this attachment.' }
                : current
            )
          }
        />
      </div>
    </div>
  ) : (
    <pre className="m-0 whitespace-pre-wrap break-words font-mono text-sm">
      {preview.content}
    </pre>
  )
}
