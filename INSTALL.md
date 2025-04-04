# Setting Up Zoo Design Studio

Compared to other CAD software, getting Zoo Design Studio up and running is quick and straightforward across platforms. It's about 100MB to download and is quick to install.

## Windows

1. Download the [Zoo Design Studio installer](https://zoo.dev/modeling-app/download) for Windows and for your processor type.

2. Once downloaded, run the installer `Zoo Design Studio-{version}-{arch}-win.exe` which should take a few seconds.

3. The installation happens at `C:\Program Files\Zoo Design Studio`. A shortcut in the start menu is also created so you can run the app easily by clicking on it.

## macOS

1. Download the [Zoo Design Studio installer](https://zoo.dev/modeling-app/download) for macOS and for your processor type.

2. Once downloaded, open the disk image `Zoo Design Studio-{version}-{arch}-mac.dmg` and drag the applications to your `Applications` directory.

3. You can then open your `Applications` directory and double-click on `Zoo Design Studio` to open.


## Linux 

1. Download the [Zoo Design Studio installer](https://zoo.dev/modeling-app/download) for Linux and for your processor type.

2. Install the dependencies needed to run the [AppImage format](https://appimage.org/).
    -  On Ubuntu, install the FUSE library with these commands in a terminal.
       ```bash
       sudo apt update
       sudo apt install libfuse2
       ```
    - Optionally, follow [these steps](https://github.com/probonopd/go-appimage/blob/master/src/appimaged/README.md#initial-setup) to install `appimaged`. It is a daemon that makes interacting with AppImage files more seamless. 
    - Once installed, copy the downloaded `Zoo Design Studio-{version}-{arch}-linux.AppImage` to the directory of your choice, for instance `~/Applications`.

   - `appimaged` should automatically find it and make it executable. If not, run:
     ```bash
     chmod a+x ~/Applications/Zoo\ Modeling\ App-{version}-{arch}-linux.AppImage
     ```

3. You can double-click on the AppImage to run it, or in a terminal with this command:
   ```bash
    ~/Applications/Zoo\ Modeling\ App-{version}-{arch}-linux.AppImage
   ```
