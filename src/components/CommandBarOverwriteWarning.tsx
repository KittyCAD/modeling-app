interface CommandBarOverwriteWarningProps {
  heading: string
  message: string
}

export function CommandBarOverwriteWarning({
  heading,
  message,
}: CommandBarOverwriteWarningProps) {
  return (
    <>
      <p className="font-bold text-destroy-60">{heading}</p>
      <p>{message}</p>
    </>
  )
}
