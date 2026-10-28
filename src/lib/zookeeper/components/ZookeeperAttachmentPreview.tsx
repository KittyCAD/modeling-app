import type { MlCopilotFile } from '@kittycad/lib'
import { CustomIcon } from '@src/components/CustomIcon'
import { reportRejection } from '@src/lib/trap'
import { useEffect, useState } from 'react'

const PREVIEW_BYTES = 256

export const ZookeeperAttachmentPreview = ({
  file,
  isPastedText = false,
}: {
  file: File | MlCopilotFile
  isPastedText?: boolean
}) => {
  const mimetype = file instanceof File ? file.type : file.mimetype
  const isImage = mimetype.startsWith('image/')
  const [localPreview, setLocalPreview] = useState<{
    file: File
    text: string
  }>()
  const [imagePreview, setImagePreview] = useState<{
    file: File | MlCopilotFile
    url: string
  }>()

  useEffect(() => {
    if (!isImage) return
    const blob =
      file instanceof File
        ? file
        : new Blob([new Uint8Array(file.data)], { type: mimetype })
    if (blob.size === 0) return

    const url = URL.createObjectURL(blob)
    setImagePreview({ file, url })
    return () => URL.revokeObjectURL(url)
  }, [file, isImage, mimetype])

  useEffect(() => {
    if (!isPastedText || !(file instanceof File)) return

    let active = true
    file
      .slice(0, PREVIEW_BYTES)
      .text()
      .then((text) => {
        if (active) setLocalPreview({ file, text })
      })
      .catch(reportRejection)
    return () => {
      active = false
    }
  }, [file, isPastedText])

  const imageUrl = imagePreview?.file === file ? imagePreview.url : undefined
  const fileIcon = <CustomIcon name="file" className="w-4 h-4 shrink-0" />
  if (isImage) {
    return (
      <span
        className="inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded"
        title={file.name}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt="Attachment preview"
            className="h-full w-full object-cover"
            onError={() =>
              setImagePreview((current) =>
                current === imagePreview ? undefined : current
              )
            }
          />
        ) : (
          <>
            {fileIcon}
            <span className="sr-only">Image</span>
          </>
        )}
      </span>
    )
  }

  const label = isPastedText
    ? (localPreview?.file === file ? localPreview.text : '')
        .replace(/\s+/g, ' ')
        .trim() || 'Pasted text'
    : file.name

  return (
    <>
      {fileIcon}
      <span
        className={`min-w-0 max-w-[160px] ${isPastedText ? 'line-clamp-2 break-words whitespace-normal text-left' : 'truncate'}`}
        title={file.name}
      >
        {label}
      </span>
    </>
  )
}
