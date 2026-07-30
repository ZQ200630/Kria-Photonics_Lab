# PA Image Post-Processor

Standalone Tauri desktop software for offline PA image reconstruction and
post-processing. It is extracted from the Butterfly Laser Control console's
PA Image Viewer and contains no board control, acquisition, laser, TEC, or
network backend code.

## Features

- Open and validate legacy PA `.bin` files.
- Inspect any frame trace and configure PTP/baseline ROIs.
- Reconstruct images with progress reporting and cancellation.
- Apply colormaps, display enhancement, rotation, zoom, and similar-pixel masks.
- Export the current processed view as PNG.

## Development

```powershell
npm ci
npm test
npm run build
npm run tauri:dev
```

The Vite development server listens on `http://127.0.0.1:1421`.
