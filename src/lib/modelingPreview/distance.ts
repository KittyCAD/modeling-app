const millimetersPerUnit: Record<string, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
  yd: 914.4,
}

/** Expressions and variable bindings remain editable through the normal input. */
export function literalDistance(text: string, defaultUnit: string) {
  const match =
    /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(mm|cm|m|in|ft|yd)?\s*$/i.exec(
      text
    )
  if (!match) return undefined
  const unit = (match[2] ?? defaultUnit).toLowerCase()
  const scale = millimetersPerUnit[unit]
  const value = Number(match[1])
  return scale && Number.isFinite(value)
    ? { millimeters: value * scale, unit, scale }
    : undefined
}
