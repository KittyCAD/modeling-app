import toast from 'react-hot-toast'

interface SketchOnImportToastProps {
  fileName: string
}

export function SketchOnImportToast({ fileName }: SketchOnImportToastProps) {
  return (
    <div className="flex flex-col gap-2">
      <span>This face is from an import</span>
      <span className="font-mono text-sm bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
        {fileName}
      </span>
      <span>Please select this from the files pane to edit</span>
    </div>
  )
}

export function showSketchOnImportToast(fileName: string) {
  toast.error(<SketchOnImportToast fileName={fileName} />)
}
