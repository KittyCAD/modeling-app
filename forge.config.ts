import type { ForgeConfig } from '@electron-forge/shared-types'
import { MakerSquirrel } from '@electron-forge/maker-squirrel'
import { MakerWix } from '@electron-forge/maker-wix'
import { MakerDMG } from '@electron-forge/maker-dmg'
import { MakerZIP } from '@electron-forge/maker-zip'
import { MakerDeb } from '@electron-forge/maker-deb'
import { MakerRpm } from '@electron-forge/maker-rpm'
import { VitePlugin } from '@electron-forge/plugin-vite'
import { MakerWix, MakerWixConfig } from '@electron-forge/maker-wix'
import { FusesPlugin } from '@electron-forge/plugin-fuses'
import { FuseV1Options, FuseVersion } from '@electron/fuses'
import path from 'path'

interface ExtendedMakerWixConfig extends MakerWixConfig {
  // see https://github.com/electron/forge/issues/3673
  // this is an undocumented property of electron-wix-msi
  associateExtensions?: string
}

const rootDir = process.cwd()

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    osxSign: (process.env.BUILD_RELEASE === 'true' && {}) || undefined,
    osxNotarize:
      (process.env.BUILD_RELEASE === 'true' && {
        appleId: process.env.APPLE_ID || '',
        appleIdPassword: process.env.APPLE_PASSWORD || '',
        teamId: process.env.APPLE_TEAM_ID || '',
      }) ||
      undefined,
    executableName: process.platform === 'linux' ? 'zoo-modeling-app' : 'Zoo Modeling App',
    icon: path.resolve(rootDir, 'assets', 'icon'),
    protocols: [
      {
        name: 'Zoo Studio',
        schemes: ['zoo-studio'],
      },
    ],
    extendInfo: 'Info.plist', // Information for file associations.
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel((arch) => ({
      // TODO: reactive once we have releases live
      remoteReleases: `https://${process.env.WEBSITE_DIR}/win32/${arch}`,
      setupIcon: path.resolve(rootDir, 'assets', 'icon.ico'),
    })),
    new MakerDMG(),
    new MakerZIP(
      (arch) => ({
        macUpdateManifestBaseUrl: `https://${process.env.WEBSITE_DIR}/darwin/${arch}`,
      }),
      ['darwin']
    ),
    new MakerWix({
      features: {
        autoLaunch: true,
        autoUpdate: true,
      },
      icon: path.resolve(rootDir, 'assets', 'icon.ico'),
      associateExtensions: 'kcl',
    } as ExtendedMakerWixConfig),
    new MakerRpm({
      options: {
        icon: path.resolve(rootDir, 'assets', 'icon.png'),
      },
    }),
    new MakerDeb({
      options: {
        icon: path.resolve(rootDir, 'assets', 'icon.png'),
      },
    }),
  ],
  publishers: [
    {
      name: '@electron-forge/publisher-gcs',
      config: {
        storageOptions: {
          projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
        },
        bucket: process.env.BUCKET_NAME,
        folder: process.env.BUCKET_FOLDER,
      },
    },
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
}

export default config
