export type ButtonTone = 'primary' | 'neutral' | 'danger'
export type ButtonEmphasis = 'solid' | 'outline' | 'ghost'

export interface ButtonClassNameOptions {
  tone?: ButtonTone
  emphasis?: ButtonEmphasis
  fullWidth?: boolean
  className?: string
}

export const BUTTON_BASE_CLASS_NAME = 'zds-button'

export function getButtonClassName({
  tone = 'primary',
  emphasis = 'solid',
  fullWidth = false,
  className,
}: ButtonClassNameOptions = {}) {
  return [
    BUTTON_BASE_CLASS_NAME,
    `${BUTTON_BASE_CLASS_NAME}--tone-${tone}`,
    `${BUTTON_BASE_CLASS_NAME}--emphasis-${emphasis}`,
    fullWidth ? `${BUTTON_BASE_CLASS_NAME}--full-width` : null,
    className,
  ]
    .filter(Boolean)
    .join(' ')
}
