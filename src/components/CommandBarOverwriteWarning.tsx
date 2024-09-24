interface CommandBarOverwriteWarningProps {
  heading?: string
  message?: string
}

export function CommandBarOverwriteWarning({
  heading = 'Overwrite current file?',
  message = 'This will permanently replace the current code in the editor.',
}: CommandBarOverwriteWarningProps) {
  return (
    <>
      <p className="font-bold text-destroy-60">{heading}</p>
      <p>{message}</p>
    </>
  )
}
