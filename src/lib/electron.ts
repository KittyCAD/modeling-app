import { app, ipcMain } from 'electron'

const DEFAULT_HOST = "https://api.zoo.dev"
const SETTINGS_FILE_NAME = "settings.toml"
const PROJECT_SETTINGS_FILE_NAME = "project.toml"
const PROJECT_FOLDER = "zoo-modeling-app-projects"


