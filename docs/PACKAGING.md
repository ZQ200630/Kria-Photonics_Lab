# Packaging

The Tauri desktop console must be built on each target OS. Linux can be built
locally from this workstation. Windows and macOS builds should be produced by
the GitHub Actions workflow in `.github/workflows/tauri-release.yml`.

## Local Linux Build

From the repository root:

```bash
cd tauri_control_console
APPIMAGE_EXTRACT_AND_RUN=1 \
PKG_CONFIG_PATH=/usr/lib/x86_64-linux-gnu/pkgconfig:/usr/share/pkgconfig:/usr/lib/pkgconfig \
PKG_CONFIG_LIBDIR=/usr/lib/x86_64-linux-gnu/pkgconfig:/usr/share/pkgconfig:/usr/lib/pkgconfig \
PATH=/home/qian/.local/nodejs/bin:/home/qian/.cargo/bin:$PATH \
npm run tauri build
```

The Linux outputs are written under:

```text
tauri_control_console/src-tauri/target/release/bundle/
```

Useful files:

```text
bundle/deb/*.deb
bundle/rpm/*.rpm
bundle/appimage/*.AppImage
```

If AppImage generation fails while downloading the AppImage runtime, use the CI
workflow or run `appimagetool` manually with a local runtime file.

## Board Payload

Files needed by `upload_pl.sh` are versioned under:

```text
board_payload/
```

Current contents:

```text
design_top.bin
pl.dtbo
axis-capture-superblock.ko
reset_all.sh
```

Run this from the repository root to upload the board payload and Python server
files to the default target:

```bash
./upload_pl.sh
```

The target can be overridden with either an argument or `PL_UPLOAD_TARGET`:

```bash
./upload_pl.sh root@192.168.8.236:/run/media/sdb1/PL/
PL_UPLOAD_TARGET=root@192.168.8.236:/run/media/sdb1/PL/ ./upload_pl.sh
```

## Cross-Platform CI Build

The workflow can be started manually from GitHub Actions, or by pushing a tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow uploads four Actions artifacts:

```text
butterfly-linux-x86_64
butterfly-windows-x86_64
butterfly-macos-x86_64
butterfly-macos-arm64
```

When triggered by a tag, the workflow also creates a GitHub Release for that tag
and uploads all platform packages as release assets.

Expected package types:

```text
Linux:   .deb, .rpm, .AppImage
Windows: .msi, .exe
macOS:   .dmg, .app
```

These builds are unsigned by default. macOS and Windows users may see system
warnings until code-signing certificates are configured.
