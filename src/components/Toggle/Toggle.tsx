import styles from './Toggle.module.css'

interface ToggleProps {
  className?: string
  offLabel?: string
  onLabel?: string
  name: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  checked: boolean
  disabled?: boolean
}

export const Toggle = ({
  className = '',
  offLabel = 'Off',
  onLabel = 'On',
  name = '',
  onChange,
  checked,
  disabled = false,
}: ToggleProps) => {
  return (
    <label
      className={`${styles.toggle} ${
        disabled ? 'opacity-50 pointer-events-none' : ''
      } ${className}`}
    >
      <p
        className={checked ? 'text-chalkboard-70 dark:text-chalkboard-50' : ''}
      >
        {offLabel}
      </p>
      <input
        type="checkbox"
        name={name}
        id={name}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
      <span></span>
      <p
        className={!checked ? 'text-chalkboard-70 dark:text-chalkboard-50' : ''}
      >
        {onLabel}
      </p>
    </label>
  )
}
