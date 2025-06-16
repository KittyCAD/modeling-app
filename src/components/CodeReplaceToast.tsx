import toast from 'react-hot-toast'
import { codeManager, kclManager } from '@src/lib/singletons'

interface CodeReplaceToastProps {
  code: string
}

export function CodeReplaceToast({ code }: CodeReplaceToastProps) {
  return (
    <div className="bg-chalkboard-10 dark:bg-chalkboard-90 p-4 rounded-md shadow-lg max-w-md">
      <div className="font-bold mb-2">Replace current code?</div>
      <div className="mb-3">
        Do you want to replace your current code with this sample?
      </div>
      <div className="flex gap-2">
        <button
          className="bg-primary text-white px-3 py-1 rounded"
          onClick={() => {
            codeManager.updateCodeEditor(code, true)
            kclManager.executeCode().catch((err) => {
              console.error('Error executing code:', err)
            })
            toast.dismiss('code-replace-toast')
          }}
        >
          Accept
        </button>
        <button
          className="bg-chalkboard-20 dark:bg-chalkboard-80 px-3 py-1 rounded"
          onClick={() => toast.dismiss('code-replace-toast')}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

export function showCodeReplaceToast(code: string) {
  // Create a persistent toast that doesn't auto-dismiss
  return toast.custom(() => <CodeReplaceToast code={code} />, {
    id: 'code-replace-toast',
    duration: Infinity, // Won't auto dismiss
    position: 'top-center',
    style: {
      zIndex: 9999, // Ensure it's above other elements
    },
  })
}
