import { CustomIcon, type CustomIconName } from '@src/components/CustomIcon'
import { useState } from 'react'
import styles from './FilePaneEmptyState.module.css'

const phrases = [
  'You can just make things.',
  'Big ideas start small.',
  'Open a file. Follow a hunch.',
  'A little tinkering goes a long way.',
  'Your next rabbit hole starts here.',
] as const

/** Shared invitation to open a file, with a phrase that stays steady until the next empty visit. */
export function FilePaneEmptyState({
  icon,
  onOpen,
}: {
  icon: CustomIconName
  onOpen?: () => void
}) {
  const [phrase] = useState(
    () => phrases[Math.floor(Math.random() * phrases.length)]
  )
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-auto p-6 text-center">
      <div className="mb-4 grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
        <CustomIcon name={icon} className="h-6 w-6" aria-hidden />
      </div>
      <h2 className="max-w-sm text-lg font-semibold">{phrase}</h2>
      {onOpen && (
        <button type="button" className={styles.openButton} onClick={onOpen}>
          <CustomIcon name="plus" className="h-3.5 w-3.5" aria-hidden />
          Open a file
        </button>
      )}
    </div>
  )
}
