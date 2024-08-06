import { useFileContext } from 'hooks/useFileContext'
import { isTauri } from 'lib/isTauri'
import { paths } from 'lib/paths'
import toast from 'react-hot-toast'
import { sep } from '@tauri-apps/api/path'
import { TextToCad_type } from '@kittycad/lib/dist/types/src/models'
import { useState } from 'react'
import { CustomIcon } from './CustomIcon'

export function ToastTextToCad({
  data,
  navigate,
  context,
}: {
  // TODO: update this type to match the actual data when API is done
  data: TextToCad_type & { fileName: string }
  navigate: (to: string) => void
  context: ReturnType<typeof useFileContext>['context']
}) {
  const [hasCopied, setHasCopied] = useState(false)
  return (
    <div className="flex items-center gap-4">
      <p>Text-to-CAD successful</p>
      {isTauri() ? (
        <button
          className="flex-none p-2"
          onClick={() => {
            navigate(
              `${paths.FILE}/${encodeURIComponent(
                `${context.project.path}${sep()}${data.fileName}`
              )}`
            )
            toast.dismiss()
          }}
        >
          Open file
        </button>
      ) : (
        <button
          onClick={() => {
            navigator.clipboard.writeText(data.outputs.kcl)
            setHasCopied(true)
          }}
          className="flex-none p-2 flex items-center gap-2"
        >
          <CustomIcon
            name={hasCopied ? 'clipboardCheckmark' : 'clipboardPlus'}
            className="w-5 h-5"
          />
          {hasCopied ? 'Copied' : 'Copy to clipboard'}
        </button>
      )}
    </div>
  )
}
