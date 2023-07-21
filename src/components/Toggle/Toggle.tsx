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
      {offLabel}
      <input
        type="checkbox"
        name={name}
        id={name}
        checked={checked}
        onChange={onChange}
      />
      <span></span>
      {onLabel}
    </label>
  )
}
