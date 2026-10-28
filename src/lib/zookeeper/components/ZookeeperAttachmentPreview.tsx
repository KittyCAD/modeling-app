import type { MlCopilotFile } from '@kittycad/lib'
import { CustomIcon } from '@src/components/CustomIcon'
import { reportRejection } from '@src/lib/trap'
import { useEffect, useState } from 'react'

const PREVIEW_BYTES = 256

export const ZookeeperAttachmentPreview = ({
  file,
}: {
  file: File | MlCopilotFile
}) => {
  const isPastedText = /^pasted-text-.+\.txt$/.test(file.name)
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

  let label = file.name
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
