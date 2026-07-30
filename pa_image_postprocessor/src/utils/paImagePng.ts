import {
  buildPaImageRaster,
  type PaImageColormap,
  type PaImageEnhancement,
  type PaImageRotation,
  type PaImageZoomDomain,
} from "../components/PaImageHeatmap";

export type PaImagePngExportDimensionsInput = {
  width: number;
  height: number;
  zoom?: PaImageZoomDomain | null;
  rotation?: PaImageRotation;
};

export type PaImagePngBytesInput = PaImagePngExportDimensionsInput & {
  values: Array<number | null>;
  counts: number[];
  colormap?: PaImageColormap;
  enhancement?: PaImageEnhancement;
  mask?: boolean[] | null;
};

function safeImageDomain(width: number, height: number, zoom?: PaImageZoomDomain | null): PaImageZoomDomain {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  if (!zoom) return { xStart: 0, xEnd: safeWidth - 1, yStart: 0, yEnd: safeHeight - 1 };
  return {
    xStart: Math.max(0, Math.min(safeWidth - 1, Math.floor(Math.min(zoom.xStart, zoom.xEnd)))),
    xEnd: Math.max(0, Math.min(safeWidth - 1, Math.floor(Math.max(zoom.xStart, zoom.xEnd)))),
    yStart: Math.max(0, Math.min(safeHeight - 1, Math.floor(Math.min(zoom.yStart, zoom.yEnd)))),
    yEnd: Math.max(0, Math.min(safeHeight - 1, Math.floor(Math.max(zoom.yStart, zoom.yEnd)))),
  };
}

export function paImagePngExportDimensions({
  width,
  height,
  zoom,
  rotation = 0,
}: PaImagePngExportDimensionsInput): { width: number; height: number } {
  const domain = safeImageDomain(width, height, zoom);
  const rasterWidth = Math.max(1, domain.xEnd - domain.xStart + 1);
  const rasterHeight = Math.max(1, domain.yEnd - domain.yStart + 1);
  return rotation === 90 || rotation === 270
    ? { width: rasterHeight, height: rasterWidth }
    : { width: rasterWidth, height: rasterHeight };
}

export function paImagePngDefaultFilename(sourcePath: string): string {
  const name = sourcePath.split(/[\\/]/).filter(Boolean).pop() ?? "";
  const stem = name.replace(/\.[^.]+$/, "");
  const safeStem = stem.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return safeStem ? `${safeStem}_pa_image.png` : "pa_image.png";
}

function drawRasterToExportCanvas(
  rasterCanvas: HTMLCanvasElement,
  exportCanvas: HTMLCanvasElement,
  rotation: PaImageRotation,
) {
  const ctx = exportCanvas.getContext("2d");
  if (!ctx) throw new Error("PNG export canvas is not available");
  ctx.clearRect(0, 0, exportCanvas.width, exportCanvas.height);
  ctx.imageSmoothingEnabled = false;
  if (rotation === 0) {
    ctx.drawImage(rasterCanvas, 0, 0);
    return;
  }

  ctx.save();
  ctx.translate(exportCanvas.width / 2, exportCanvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(rasterCanvas, -rasterCanvas.width / 2, -rasterCanvas.height / 2);
  ctx.restore();
}

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("PNG export failed"));
        return;
      }
      blob.arrayBuffer()
        .then((buffer) => resolve(new Uint8Array(buffer)))
        .catch(reject);
    }, "image/png");
  });
}

export async function paImagePngBytes({
  width,
  height,
  values,
  counts,
  zoom,
  colormap = "magma",
  enhancement = "percentile",
  rotation = 0,
  mask,
}: PaImagePngBytesInput): Promise<Uint8Array> {
  if (typeof document === "undefined") {
    throw new Error("PNG export requires a browser canvas");
  }
  const raster = buildPaImageRaster({ width, height, values, counts, zoom, colormap, enhancement, mask });
  const exportDimensions = paImagePngExportDimensions({ width, height, zoom, rotation });
  const rasterCanvas = document.createElement("canvas");
  rasterCanvas.width = raster.width;
  rasterCanvas.height = raster.height;
  const rasterCtx = rasterCanvas.getContext("2d");
  if (!rasterCtx) throw new Error("PNG raster canvas is not available");
  const imageData = rasterCtx.createImageData(raster.width, raster.height);
  imageData.data.set(raster.pixels);
  rasterCtx.putImageData(imageData, 0, 0);

  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = exportDimensions.width;
  exportCanvas.height = exportDimensions.height;
  drawRasterToExportCanvas(rasterCanvas, exportCanvas, rotation);
  return canvasToPngBytes(exportCanvas);
}
