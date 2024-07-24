import { contextBridge } from 'electron'
import path from 'path'
import fs from 'node:fs'

// All these functions call into lib/electron since many require filesystem
// access, and the second half is the original tauri code also stored app
// state on the "desktop" side.

const DEFAULT_HOST = "https://api.zoo.dev"
const SETTINGS_FILE_NAME = "settings.toml"
const PROJECT_SETTINGS_FILE_NAME = "project.toml"
const PROJECT_FOLDER = "zoo-modeling-app-projects"

contextBridge.exposeInMainWorld("fs", {
  readFile(p: string) { return fs.readFile(p, 'utf-8') },
  readdir(p: string) { return fs.readdir(p, 'utf-8') },
  join() { return path.join(...arguments) },
  exists(p: string) { fs.exists(p) },
})
