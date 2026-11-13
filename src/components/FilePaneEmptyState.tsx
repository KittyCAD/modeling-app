import { CustomIcon, type CustomIconName } from '@src/components/CustomIcon'
import { EmptyState } from '@kittycad/ui-components'
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
    <EmptyState
      icon={<CustomIcon name={icon} className="h-6 w-6" aria-hidden />}
      action={
        onOpen && (
          <button type="button" className={styles.openButton} onClick={onOpen}>
            <CustomIcon name="plus" className="h-3.5 w-3.5" aria-hidden />
            Open a file
          </button>
        )
      }
    >
      {phrase}
    </EmptyState>
  )
}
