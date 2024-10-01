interface CommandBarOverwriteWarningProps {
  heading?: string
  message?: string
}

export function CommandBarOverwriteWarning({
  heading = 'Overwrite current file and units?',
  message = 'This will permanently replace the current code in the editor, and overwrite your current units.',
}: CommandBarOverwriteWarningProps) {
  return (
    <>
      <p className="font-bold text-destroy-60">{heading}</p>
      <p>{message}</p>
    </>
  )
}
