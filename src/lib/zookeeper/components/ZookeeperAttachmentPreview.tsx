import type { MlCopilotFile } from '@kittycad/lib'
import { CustomIcon } from '@src/components/CustomIcon'
import { reportRejection } from '@src/lib/trap'
import { useEffect, useState } from 'react'

const PREVIEW_BYTES = 256

export const ZookeeperAttachmentPreview = ({
  file,
  icon = 'file',
}: {
  file: File | MlCopilotFile
  icon?: 'file' | 'paperclip'
}) => {
  const mimetype = file instanceof File ? file.type : file.mimetype
  const isImage = mimetype.startsWith('image/')
  const isPastedText = !isImage && /^pasted-text-.+\.txt$/.test(file.name)
  const [localPreview, setLocalPreview] = useState<{
    file: File
    text: string
  }>()
  const [imagePreview, setImagePreview] = useState<{
    file: File | MlCopilotFile
    url: string
  }>()
  const [failedImageUrl, setFailedImageUrl] = useState<string>()

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
  let label = isImage ? 'Image' : file.name
  if (isPastedText) {
    const preview =
      file instanceof File
        ? localPreview?.file === file
          ? localPreview.text
          : ''
        : new TextDecoder().decode(
            new Uint8Array(file.data.slice(0, PREVIEW_BYTES))
          )
    label = preview.replace(/\s+/g, ' ').trim() || 'Pasted text'
  }

  return (
    <>
      {imageUrl && failedImageUrl !== imageUrl ? (
        <img
          src={imageUrl}
          alt="Attachment preview"
          className="h-8 w-8 shrink-0 rounded object-cover"
          onError={() => setFailedImageUrl(imageUrl)}
        />
      ) : (
        <CustomIcon
          name={icon}
          className={icon === 'file' ? 'w-4 h-4 shrink-0' : 'w-3 h-3 shrink-0'}
        />
      )}
      <span className="min-w-0 max-w-[160px] truncate" title={file.name}>
        {label}
      </span>
    </>
  )
}
