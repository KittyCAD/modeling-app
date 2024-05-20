import { ActionButton } from 'components/ActionButton'
import Tooltip from 'components/Tooltip'
import toast from 'react-hot-toast'

interface CopyJsonMenuProps {
  json: object
  label: string
}

export const CopyJsonMenu = ({ json, label }: CopyJsonMenuProps) => {
  function copyProgramMemoryToClipboard() {
    if (globalThis && 'navigator' in globalThis) {
      try {
        navigator.clipboard.writeText(JSON.stringify(json))
        toast.success(
          `${
            label.slice(0, 1).toLocaleUpperCase() + label.slice(1)
          } copied to clipboard`
        )
      } catch (e) {
        toast.error(`Failed to copy ${label} to clipboard`)
      }
    }
  }

  return (
    <>
      <ActionButton
        Element="button"
        iconStart={{
          icon: 'clipboardPlus',
          iconClassName: '!text-current',
          bgClassName: 'bg-transparent',
        }}
        className="!p-0 !bg-transparent hover:text-primary border-transparent hover:border-primary !outline-none"
        onClick={copyProgramMemoryToClipboard}
      >
        <Tooltip position="bottom-right" delay={750}>
          Copy to clipboard
        </Tooltip>
      </ActionButton>
    </>
  )
}
