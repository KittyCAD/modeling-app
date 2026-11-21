/** Opaque files have a read-only presentation without a decoded text surface. */
export function BinaryFileView() {
  return (
    <p className="p-3 text-sm text-2">
      This file is read-only because its format is binary or is not recognized
      as text.
    </p>
  )
}
