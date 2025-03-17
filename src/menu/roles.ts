import {MenuItemConstructorOptions} from 'electron'

export type roles = 'help'
export type labels = 'Learn more' | 'proxy js'


export interface ZooMenuItemConstructorOptions extends MenuItemConstructorOptions {
  label: roles
}
