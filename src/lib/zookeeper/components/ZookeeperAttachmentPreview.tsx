import type { MlCopilotFile } from '@kittycad/lib'
import { CustomIcon } from '@src/components/CustomIcon'
import { reportRejection } from '@src/lib/trap'
import { ZookeeperImagePreview } from '@src/lib/zookeeper/components/ZookeeperImagePreview'
import { useEffect, useState } from 'react'

const PREVIEW_BYTES = 256

export const ZookeeperAttachmentPreview = ({
  file,
  isPastedText = false,
}: {
  file: File | MlCopilotFile
  isPastedText?: boolean
}) => {
  const [imagePreview, setImagePreview] = useState<{
    file: File | MlCopilotFile
    url: string
  }>()
  useEffect(() => {
    const mimetype = file instanceof File ? file.type : file.mimetype
    if (!mimetype.startsWith('image/')) return
    if (!(file instanceof File) && file.data.length === 0) return

    const blob =
      file instanceof File
        ? file
        : new Blob([new Uint8Array(file.data)], { type: mimetype })
    const url = URL.createObjectURL(blob)
    setImagePreview({ file, url })
    return () => URL.revokeObjectURL(url)
  }, [file])

  const [localPreview, setLocalPreview] = useState<{
    file: File
    text: string
  }>()

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

  const label = isPastedText
    ? (localPreview?.file === file ? localPreview.text : '')
        .replace(/\s+/g, ' ')
        .trim() || 'Pasted text'
    : file.name

  if (imagePreview?.file === file) {
    return (
      <ZookeeperImagePreview
        key={imagePreview.url}
        url={imagePreview.url}
        name={file.name}
      />
    )
  }

  return (
    <>
      <CustomIcon name="file" className="w-4 h-4 shrink-0" />
      <span
        className={`min-w-0 max-w-[160px] ${isPastedText ? 'line-clamp-2 break-words whitespace-normal text-left' : 'truncate'}`}
        title={file.name}
      >
        {label}
      </span>
    </>
  )
}
