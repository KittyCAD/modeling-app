# Setting Up Zoo Design Studio

Compared to other CAD software, getting Zoo Design Studio up and running is quick and straightforward across platforms. It's about 100MB to download and is quick to install.

## Windows

1. Download the [Zoo Design Studio installer](https://zoo.dev/design-studio/download) for Windows and for your processor type.

2. Once downloaded, run the installer `Zoo Design Studio-{version}-{arch}-win.exe` which should take a few seconds.

3. The installation happens at `C:\Program Files\Zoo Design Studio`. A shortcut in the start menu is also created so you can run the app easily by clicking on it.

## macOS

1. Download the [Zoo Design Studio installer](https://zoo.dev/design-studio/download) for macOS and for your processor type.

2. Once downloaded, open the disk image `Zoo Design Studio-{version}-{arch}-mac.dmg` and drag the applications to your `Applications` directory.

3. You can then open your `Applications` directory and double-click on `Zoo Design Studio` to open.


## Linux

1. Download the [Zoo Design Studio AppImage](https://zoo.dev/design-studio/download) for your processor: x86-64 for Intel/AMD, or ARM64 for ARM.

2. Install the FUSE 2 library. On Ubuntu 24.04 and later:

   ```bash
   sudo apt update
   sudo apt install libfuse2t64
   ```

   On Ubuntu 22.04, use `sudo apt install libfuse2` instead. FUSE 2 can coexist with FUSE 3; you do not need to remove FUSE 3. See the [AppImage FUSE guide](https://docs.appimage.org/user-guide/troubleshooting/fuse.html) for other distributions.

   On ARM, `zlib1g-dev` may also be required and can be installed with `sudo apt install zlib1g-dev`.

3. Copy the AppImage to a directory of your choice, such as `~/Applications` (create it if needed). In the commands below, replace `your-download.AppImage` with the exact downloaded filename. Keep the quotes so filenames containing spaces work:

   ```bash
   appimage="$HOME/Applications/your-download.AppImage"
   chmod +x "$appimage"
   "$appimage"
   ```

   After making it executable, you can also double-click the AppImage to launch it. For optional application-menu integration, see the [appimaged setup instructions](https://github.com/probonopd/go-appimage/blob/master/src/appimaged/README.md#initial-setup).

### Ubuntu sandbox startup errors

Ubuntu 24.04 and later [restrict unprivileged user namespaces](https://discourse.ubuntu.com/t/understanding-apparmor-user-namespace-restriction/58007), which can prevent Electron's sandbox from starting. Installing FUSE and making the AppImage executable do not configure this permission.

If startup still fails with an error mentioning `chrome-sandbox` or `No usable sandbox`, see [the tracked Ubuntu startup issue](https://github.com/KittyCAD/modeling-app/issues/7319). Include your Ubuntu release, Zoo version, CPU architecture, and the full terminal error when reporting it. Avoid disabling the sandbox with `--no-sandbox` or turning off AppArmor restrictions globally.
