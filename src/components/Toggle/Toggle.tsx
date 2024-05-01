import styles from './Toggle.module.css'

interface ToggleProps {
  className?: string
  offLabel?: string
  onLabel?: string
  name: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  checked: boolean
}

export const Toggle = ({
  className = '',
  offLabel = 'Off',
  onLabel = 'On',
  name = '',
  onChange,
  checked,
}: ToggleProps) => {
  return (
    <label className={`${styles.toggle} ${className}`}>
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
