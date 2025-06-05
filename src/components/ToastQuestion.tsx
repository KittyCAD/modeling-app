import toast from 'react-hot-toast'

interface ToastQuestionProps {
  question: string
  onYes: () => void
  onNo: () => void
}

const TOAST_ID = 'toast-question'

export function ToastQuestion(props: ToastQuestionProps) {
  return (
    <div className="bg-chalkboard-10 dark:bg-chalkboard-90 p-4 rounded-md shadow-lg max-w-md">
      <div className="font-bold mb-2">Question</div>
      <div className="mb-3">{props.question}</div>
      <div className="flex gap-2">
        <button
          className="bg-chalkboard-20 dark:bg-chalkboard-80 px-3 py-1 rounded"
          onClick={() => {
            toast.dismiss(TOAST_ID)
            props.onYes()
          }}
        >
          Yes
        </button>
        <button
          className="bg-chalkboard-20 dark:bg-chalkboard-80 px-3 py-1 rounded"
          onClick={() => {
            toast.dismiss(TOAST_ID)
            props.onNo()
          }}
        >
          No
        </button>
      </div>
    </div>
  )
}

export function askQuestionPrompt(props: ToastQuestionProps) {
  // Create a persistent toast that doesn't auto-dismiss
  return toast.custom(() => <ToastQuestion {...props} />, {
    id: TOAST_ID,
    duration: Infinity, // Won't auto dismiss
    position: 'top-center',
    style: {
      zIndex: 9999, // Ensure it's above other elements
    },
  })
}
