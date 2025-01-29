/**
 * @file pic-pixeller.tsx
 * @description A web-based tool that transforms regular images into pixel art with customizable settings.
 * Implements advanced image processing techniques including edge preservation, color quantization,
 * and Floyd-Steinberg dithering with adjustable parameters.
 */

import React, { useState, useCallback, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * Type definition for pixel art conversion options.
 * All parameters are optional to allow partial configuration updates.
 */
type Options = {
  targetWidth?: number;
  colorLimit?: number;
  dithering?: boolean;
  preserveEdges?: boolean;
  edgeThreshold?: number;
  posterizationLevels?: number;
  ditheringStrength?: number;
  palette?: Array<{ r: number; g: number; b: number; a: number }>;
};

/**
 * PicPixeller is a pixel art conversion tool that focuses on high-quality results
 * through intelligent color quantization, edge preservation, and customizable dithering.
 * The implementation uses several advanced techniques:
 *
 * 1. Color Space Management:
 *    - RGB colors are converted to HSL for better color grouping
 *    - Perceptual color weights are used for better matching
 *
 * 2. Edge Detection:
 *    - Uses a custom threshold-based algorithm
 *    - Preserves important details while smoothing other areas
 *
 * 3. Color Palette Generation:
 *    - Colors are grouped by hue bins for better distribution
 *    - Uses a grid-based approach in the saturation-lightness space
 *
 * 4. Dithering:
 *    - Implements Floyd-Steinberg algorithm with customizable strength
 *    - Error distribution is weighted to maintain image quality
 */
class PicPixeller {
  weights: { r: number; g: number; b: number };
  options: Options;

  constructor(options = {}) {
    // Perceptual weights for RGB channels based on human vision
    this.weights = { r: 0.299, g: 0.587, b: 0.114 };
    this.options = {
      edgeThreshold: 100,
      posterizationLevels: 8,
      ditheringStrength: 1.0,
      ...options,
    };
  }

  /**
   * Main conversion function that orchestrates the pixel art creation process.
   * Steps:
   * 1. Resize the image to target dimensions
   * 2. Apply edge preservation if enabled
   * 3. Generate or use provided color palette
   * 4. Apply dithering or direct color quantization
   */
  async convertToPixelArt(imageData, options = {}) {
    const {
      targetWidth = 64,
      colorLimit = 32,
      dithering = true,
      preserveEdges = true,
      ditheringStrength = this.options.ditheringStrength,
      palette = null,
    }: Options = options;

    const resized = await this.resizeImage(imageData, targetWidth);
    const processed = preserveEdges
      ? this.detectAndPreserveEdges(resized)
      : resized;

    const colorPalette = palette || this.generatePalette(processed, colorLimit);

    return dithering
      ? this.applyDithering(processed, colorPalette, ditheringStrength)
      : this.quantizeColors(processed, colorPalette);
  }

  /**
   * Generates an optimized color palette from the input image.
   * The algorithm works in multiple steps:
   * 1. Convert colors to HSL space for better grouping
   * 2. Group colors into hue bins (12 bins)
   * 3. Within each hue bin, create a 4x4 grid in the saturation-lightness space
   * 4. Average colors within each grid cell
   * 5. Select the most representative colors based on usage frequency
   *
   * This approach ensures:
   * - Even color distribution across the hue spectrum
   * - Preservation of dominant colors
   * - Balance between similar colors
   */
  generatePalette(imageData, colorLimit) {
    const pixels = [];
    for (let i = 0; i < imageData.data.length; i += 4) {
      const r = imageData.data[i];
      const g = imageData.data[i + 1];
      const b = imageData.data[i + 2];
      const hsl = this.rgbToHsl(r, g, b);
      pixels.push({ r, g, b, h: hsl.h, s: hsl.s, l: hsl.l, count: 1 });
    }

    const hueBins = new Map();
    const HUE_BINS = 12;

    pixels.forEach((pixel) => {
      const hueBin = Math.floor(pixel.h * HUE_BINS);
      if (!hueBins.has(hueBin)) {
        hueBins.set(hueBin, []);
      }
      hueBins.get(hueBin).push(pixel);
    });

    const palette = [];
    const colorsPerBin = Math.ceil(colorLimit / HUE_BINS);

    hueBins.forEach((binPixels) => {
      if (binPixels.length === 0) return;

      const slGrid = new Map();
      const SL_GRID = 4;

      binPixels.forEach((pixel) => {
        const sIndex = Math.floor(pixel.s * SL_GRID);
        const lIndex = Math.floor(pixel.l * SL_GRID);
        const key = `${sIndex},${lIndex}`;

        if (!slGrid.has(key)) {
          slGrid.set(key, { r: 0, g: 0, b: 0, count: 0 });
        }

        const cell = slGrid.get(key);
        cell.r += pixel.r;
        cell.g += pixel.g;
        cell.b += pixel.b;
        cell.count++;
      });

      const cellColors = Array.from(slGrid.entries())
        .map(([key, cell]) => ({
          r: Math.round(cell.r / cell.count),
          g: Math.round(cell.g / cell.count),
          b: Math.round(cell.b / cell.count),
          count: cell.count,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, colorsPerBin);

      palette.push(...cellColors);
    });

    return palette
      .sort((a, b) => b.count - a.count)
      .slice(0, colorLimit)
      .map((color) => ({ ...color, a: 255 }));
  }

  /**
   * Resizes the input image to the target width while maintaining aspect ratio.
   * Uses nearest-neighbor sampling for pixel art-friendly results.
   * This simple approach is chosen over more complex algorithms because:
   * 1. It preserves sharp edges better than bilinear/bicubic interpolation
   * 2. It's more suitable for pixel art style
   * 3. Subsequent processing steps will handle the final appearance
   */
  async resizeImage(imageData, targetWidth) {
    const ratio = targetWidth / imageData.width;
    const targetHeight = Math.round(imageData.height * ratio);
    const output = new ImageData(targetWidth, targetHeight);

    const scaleX = imageData.width / targetWidth;
    const scaleY = imageData.height / targetHeight;

    for (let y = 0; y < targetHeight; y++) {
      for (let x = 0; x < targetWidth; x++) {
        const srcX = Math.floor(x * scaleX);
        const srcY = Math.floor(y * scaleY);
        const pixel = this.getRGBA(imageData, srcX, srcY);
        this.setRGBA(output, x, y, pixel);
      }
    }

    return output;
  }

  /**
   * Detects and preserves important edges while smoothing other areas.
   * The algorithm:
   * 1. Examines each pixel's neighborhood (8 surrounding pixels)
   * 2. Calculates brightness differences using perceptual weights
   * 3. If the difference exceeds the threshold, considers it an edge
   * 4. Non-edge pixels are averaged with their neighbors
   *
   * This helps maintain image clarity while reducing noise and
   * creating more cohesive color areas for better pixelation.
   */
  detectAndPreserveEdges(imageData) {
    const output = new ImageData(imageData.width, imageData.height);
    const threshold = this.options.edgeThreshold;

    for (let i = 0; i < imageData.data.length; i++) {
      output.data[i] = imageData.data[i];
    }

    for (let y = 0; y < imageData.height; y++) {
      for (let x = 0; x < imageData.width; x++) {
        const neighbors = this.getNeighborPixels(imageData, x, y);
        const center = this.getRGBA(imageData, x, y);

        if (neighbors.length > 0) {
          const isEdge = this.isEdgePixel(center, neighbors, threshold);
          if (!isEdge) {
            const avgColor = this.averageColor(neighbors);
            this.setRGBA(output, x, y, avgColor);
          }
        }
      }
    }

    return output;
  }

  /**
   * Applies Floyd-Steinberg dithering with adjustable strength.
   * The process:
   * 1. For each pixel, find the closest palette color
   * 2. Calculate the color error (difference between original and palette color)
   * 3. Distribute the error to neighboring pixels using the F-S pattern:
   *      X   7/16
   *    3/16  5/16  1/16
   *
   * The strength parameter allows users to control the dithering intensity,
   * making it possible to achieve different artistic effects.
   */
  applyDithering(imageData, palette, strength) {
    const output = new ImageData(imageData.width, imageData.height);
    const errors = Array(imageData.height)
      .fill(undefined)
      .map(() =>
        Array(imageData.width)
          .fill(undefined)
          .map(() => ({ r: 0, g: 0, b: 0 }))
      );

    for (let y = 0; y < imageData.height; y++) {
      for (let x = 0; x < imageData.width; x++) {
        const pixel = this.getRGBA(imageData, x, y);
        const error = errors[y][x];

        const adjustedPixel = {
          r: pixel.r + error.r * strength,
          g: pixel.g + error.g * strength,
          b: pixel.b + error.b * strength,
          a: pixel.a,
        };

        const newPixel = this.findClosestColor(adjustedPixel, palette);
        this.setRGBA(output, x, y, newPixel);

        const pixelError = {
          r: adjustedPixel.r - newPixel.r,
          g: adjustedPixel.g - newPixel.g,
          b: adjustedPixel.b - newPixel.b,
        };

        this.distributeError(
          errors,
          pixelError,
          x,
          y,
          imageData.width,
          imageData.height
        );
      }
    }

    return output;
  }

  /**
   * Distributes color error to neighboring pixels according to
   * the Floyd-Steinberg dithering matrix. The error distribution
   * helps create smooth transitions between colors while maintaining
   * the overall color balance of the image.
   */
  distributeError(errors, error, x, y, width, height) {
    const distribution = [
      [x + 1, y, 7 / 16],
      [x - 1, y + 1, 3 / 16],
      [x, y + 1, 5 / 16],
      [x + 1, y + 1, 1 / 16],
    ];

    for (const [nx, ny, weight] of distribution) {
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        errors[ny][nx].r += error.r * weight;
        errors[ny][nx].g += error.g * weight;
        errors[ny][nx].b += error.b * weight;
      }
    }
  }

  /**
   * Performs direct color quantization without dithering.
   * Each pixel is mapped to the closest color in the palette
   * using the perceptual color distance calculation.
   */
  quantizeColors(imageData, palette) {
    const output = new ImageData(imageData.width, imageData.height);

    for (let y = 0; y < imageData.height; y++) {
      for (let x = 0; x < imageData.width; x++) {
        const pixel = this.getRGBA(imageData, x, y);
        const newColor = this.findClosestColor(pixel, palette);
        this.setRGBA(output, x, y, newColor);
      }
    }

    return output;
  }

  /**
   * Utility function to get RGBA values of a pixel at specified coordinates.
   * Returns an object with r, g, b, a components.
   */
  getRGBA(imageData, x, y) {
    const index = (y * imageData.width + x) * 4;
    return {
      r: imageData.data[index],
      g: imageData.data[index + 1],
      b: imageData.data[index + 2],
      a: imageData.data[index + 3],
    };
  }

  /**
   * Utility function to set RGBA values of a pixel at specified coordinates.
   * Ensures values are within valid range (0-255).
   */
  setRGBA(imageData, x, y, color) {
    const index = (y * imageData.width + x) * 4;
    imageData.data[index] = Math.max(0, Math.min(255, Math.round(color.r)));
    imageData.data[index + 1] = Math.max(0, Math.min(255, Math.round(color.g)));
    imageData.data[index + 2] = Math.max(0, Math.min(255, Math.round(color.b)));
    imageData.data[index + 3] = Math.max(0, Math.min(255, Math.round(color.a)));
  }

  /**
   * Finds the closest color in the palette to a given color.
   * Uses perceptual color distance for better matching results.
   */
  findClosestColor(color1, palette) {
    let minDistance = Infinity;
    let closest = palette[0];

    for (const paletteColor of palette) {
      const distance = this.colorDistance(color1, paletteColor);
      if (distance < minDistance) {
        minDistance = distance;
        closest = paletteColor;
      }
    }

    return closest;
  }

  /**
   * Calculates a perceptually weighted color distance between two colors.
   * Uses different weights for R,G,B channels based on human perception:
   * - R: 0.299 (red contributes ~30% to perceived brightness)
   * - G: 0.587 (green contributes ~59% to perceived brightness)
   * - B: 0.114 (blue contributes ~11% to perceived brightness)
   *
   * Special handling for grayscale colors:
   * - Increases distance for grayscale palette colors
   * - This helps prevent unwanted conversion to grayscale
   * - Exception for pure black to allow proper shadows
   */
  colorDistance(color1, color2) {
    const rDiff = color1.r - color2.r;
    const gDiff = color1.g - color2.g;
    const bDiff = color1.b - color2.b;

    const isGrayscale2 = color2.r === color2.g && color2.g === color2.b;

    let distance = Math.sqrt(
      rDiff * rDiff * this.weights.r +
        gDiff * gDiff * this.weights.g +
        bDiff * bDiff * this.weights.b
    );

    if (isGrayscale2 && !(color2.r === 0 && color2.g === 0 && color2.b === 0)) {
      distance *= 1.5;
    }

    return distance;
  }

  /**
   * Returns an array of neighboring pixels for a given coordinate.
   * Used in edge detection and preservation.
   */
  getNeighborPixels(imageData, x, y) {
    const neighbors = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (
          nx >= 0 &&
          nx < imageData.width &&
          ny >= 0 &&
          ny < imageData.height
        ) {
          neighbors.push(this.getRGBA(imageData, nx, ny));
        }
      }
    }
    return neighbors;
  }

  /**
   * Determines if a pixel is part of an edge based on its
   * difference from neighboring pixels.
   */
  isEdgePixel(center, neighbors, threshold) {
    for (const neighbor of neighbors) {
      const diff = Math.abs(
        center.r * this.weights.r +
          center.g * this.weights.g +
          center.b * this.weights.b -
          (neighbor.r * this.weights.r +
            neighbor.g * this.weights.g +
            neighbor.b * this.weights.b)
      );
      if (diff > threshold) return true;
    }
    return false;
  }

  /**
   * Calculates the average color of an array of pixels.
   * Used for smoothing non-edge areas.
   */
  averageColor(pixels) {
    const sum = pixels.reduce(
      (acc, pixel) => ({
        r: acc.r + pixel.r,
        g: acc.g + pixel.g,
        b: acc.b + pixel.b,
        a: acc.a + pixel.a,
      }),
      { r: 0, g: 0, b: 0, a: 0 }
    );

    return {
      r: sum.r / pixels.length,
      g: sum.g / pixels.length,
      b: sum.b / pixels.length,
      a: sum.a / pixels.length,
    };
  }

  /**
   * Converts RGB color values to HSL color space.
   * Used for better color grouping in palette generation.
   */
  rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h,
      s,
      l = (max + min) / 2;

    if (max === min) {
      h = s = 0;
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

      switch (max) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        case b:
          h = (r - g) / d + 4;
          break;
      }

      h /= 6;
    }

    return { h, s, l };
  }
}

/**
 * React component for the PicPixeller interface.
 * Key features:
 * - Real-time preview of pixel art conversion
 * - Drag-and-drop image upload
 * - Interactive controls for all conversion parameters
 * - Custom palette editing with validation
 * - Transparent background support
 * - PNG export functionality
 *
 * Uses the shadcn/ui library for consistent styling and
 * follows React best practices for state management and
 * component lifecycle handling.
 */
const PicPixellerComponent = () => {
  // State management for UI controls and processing status
  const [processing, setProcessing] = useState(false);
  const [currentPalette, setCurrentPalette] = useState([]);
  const [paletteText, setPaletteText] = useState("");
  const [error, setError] = useState("");
  const [settings, setSettings] = useState({
    targetWidth: 200,
    colorLimit: 16,
    dithering: true,
    preserveEdges: true,
    useCurrentPalette: false,
    ditheringStrength: 0.3,
  });

  // Canvas references for source and result images
  const sourceCanvasRef = useRef(null);
  const resultCanvasRef = useRef(null);

  /**
   * Formats palette data for display in the text editor.
   * Converts internal color objects to readable RGB arrays.
   */
  const formatPalette = (palette) => {
    const formattedColors = palette.map((color) => [
      Math.round(color.r),
      Math.round(color.g),
      Math.round(color.b),
    ]);
    return JSON.stringify(formattedColors)
      .replace(/\],\[/g, "],\n[")
      .replace("[[", "[\n[")
      .replace("]]", "]\n]");
  };

  // Update text editor when palette changes
  useEffect(() => {
    setPaletteText(formatPalette(currentPalette));
  }, [currentPalette]);

  /**
   * Validates the custom color palette format and values.
   * Ensures all colors have valid RGB components (0-255).
   */
  const validatePalette = (palette) => {
    if (!Array.isArray(palette) || palette.length === 0) {
      throw new Error("Invalid palette: Palette must be a non-empty array");
    }

    const hasValidColors = palette.every(
      (color) =>
        typeof color.r === "number" &&
        typeof color.g === "number" &&
        typeof color.b === "number" &&
        color.r >= 0 &&
        color.r <= 255 &&
        color.g >= 0 &&
        color.g <= 255 &&
        color.b >= 0 &&
        color.b <= 255
    );

    if (!hasValidColors) {
      throw new Error(
        "Invalid palette: Each color must have valid RGB values (0-255)"
      );
    }

    return true;
  };

  /**
   * Generates a demo image for initial display.
   * Creates a gradient pattern with some basic shapes.
   */
  const generateDemoImage = useCallback(async () => {
    const canvas = sourceCanvasRef.current;
    const ctx = canvas.getContext("2d");
    const width = 512;
    const height = 512;

    canvas.width = width;
    canvas.height = height;

    // Generate gradient and pattern demo image
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#ff6b6b");
    gradient.addColorStop(0.5, "#4ecdc4");
    gradient.addColorStop(1, "#45b7d1");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Add some shapes
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, 100, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#2c3e50";
    ctx.fillRect(width / 4, height / 4, 100, 100);

    return ctx.getImageData(0, 0, width, height);
  }, []);

  /**
   * Main conversion handler that processes the source image
   * and updates the result preview.
   */
  const convertToPixelArt = useCallback(async () => {
    if (!sourceCanvasRef.current || !resultCanvasRef.current || processing)
      return;

    try {
      setProcessing(true);
      setError("");
      const sourceCtx = sourceCanvasRef.current.getContext("2d");
      const resultCtx = resultCanvasRef.current.getContext("2d");
      const sourceImageData = sourceCtx.getImageData(
        0,
        0,
        sourceCanvasRef.current.width,
        sourceCanvasRef.current.height
      );

      const converter = new PicPixeller();

      let palette;
      if (settings.useCurrentPalette) {
        try {
          validatePalette(currentPalette);
          palette = currentPalette;
        } catch (e) {
          throw new Error(`Cannot use current palette: ${e.message}`);
        }
      } else {
        palette = converter.generatePalette(
          sourceImageData,
          settings.colorLimit
        );
        setCurrentPalette(palette);
      }

      const result = await converter.convertToPixelArt(sourceImageData, {
        ...settings,
        palette,
      });

      resultCanvasRef.current.width = result.width;
      resultCanvasRef.current.height = result.height;
      resultCtx.putImageData(result, 0, 0);
    } catch (error) {
      console.error("Conversion error:", error);
      setError(error.message);
    } finally {
      setProcessing(false);
    }
  }, [settings, processing, currentPalette]);

  /**
   * Handles drag and drop image upload.
   * Supports common image formats and updates the preview.
   */
  const handleDrop = useCallback(
    async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        const file = e.dataTransfer.files[0];
        if (!file.type.startsWith("image/")) {
          alert("Please drop an image file");
          return;
        }

        try {
          const img = new Image();
          img.src = URL.createObjectURL(file);
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
          });

          const canvas = sourceCanvasRef.current;
          const ctx = canvas.getContext("2d");

          canvas.width = img.width;
          canvas.height = img.height;

          ctx.drawImage(img, 0, 0);
          await convertToPixelArt();

          URL.revokeObjectURL(img.src);
        } catch (error) {
          console.error("Image loading error:", error);
          alert("Failed to load image");
        }
      }
    },
    [convertToPixelArt]
  );

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // Initialize with demo image
  React.useEffect(() => {
    generateDemoImage().then(() => convertToPixelArt());
  }, []);

  // Style definitions for drag and drop zone
  const dropZoneStyle: React.CSSProperties = {
    position: "relative",
    cursor: "pointer",
  };

  const overlayStyle: React.CSSProperties = {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.1)",
    borderRadius: "0.5rem",
    pointerEvents: "none",
  };

  return (
    <Card className="w-full max-w-4xl mx-auto">
      <CardContent className="p-6">
        <div className="space-y-6">
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <Label>Target Width</Label>
                <Slider
                  value={[settings.targetWidth]}
                  min={8}
                  max={256}
                  step={4}
                  onValueChange={(value) =>
                    setSettings((prev) => ({ ...prev, targetWidth: value[0] }))
                  }
                  className="mt-2"
                />
                <div className="text-sm text-muted-foreground mt-1">
                  {settings.targetWidth}px
                </div>
              </div>

              <div>
                <Label>Color Limit</Label>
                <Slider
                  value={[settings.colorLimit]}
                  min={2}
                  max={64}
                  step={2}
                  disabled={settings.useCurrentPalette}
                  onValueChange={(value) =>
                    setSettings((prev) => ({ ...prev, colorLimit: value[0] }))
                  }
                  className="mt-2"
                />
                <div className="text-sm text-muted-foreground mt-1">
                  {settings.colorLimit} colors
                </div>
              </div>

              <div>
                <Label>Dithering Strength</Label>
                <Slider
                  value={[settings.ditheringStrength]}
                  min={0}
                  max={1}
                  step={0.1}
                  disabled={!settings.dithering}
                  onValueChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      ditheringStrength: value[0],
                    }))
                  }
                  className="mt-2"
                />
                <div className="text-sm text-muted-foreground mt-1">
                  {(settings.ditheringStrength * 100).toFixed(0)}%
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  checked={settings.dithering}
                  onCheckedChange={(checked) =>
                    setSettings((prev) => ({ ...prev, dithering: checked }))
                  }
                />
                <Label>Enable Dithering</Label>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  checked={settings.preserveEdges}
                  onCheckedChange={(checked) =>
                    setSettings((prev) => ({ ...prev, preserveEdges: checked }))
                  }
                />
                <Label>Preserve Edges</Label>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  checked={settings.useCurrentPalette}
                  onCheckedChange={(checked) =>
                    setSettings((prev) => ({
                      ...prev,
                      useCurrentPalette: checked,
                    }))
                  }
                />
                <Label>Use Current Palette</Label>
              </div>

              <Button
                onClick={convertToPixelArt}
                disabled={processing}
                className="w-full"
              >
                {processing ? "Converting..." : "Convert to Pixel Art"}
              </Button>

              <div>
                <Label>Current Palette</Label>
                <Textarea
                  value={paletteText}
                  onChange={(e) => {
                    try {
                      const input = e.target.value;
                      setPaletteText(input);
                      const parsed = JSON.parse(input);

                      // Convert RGB array to palette object array
                      const newPalette = parsed.map(([r, g, b]) => ({
                        r: Number(r),
                        g: Number(g),
                        b: Number(b),
                        a: 255,
                      }));

                      // Validate palette
                      if (validatePalette(newPalette)) {
                        setCurrentPalette(newPalette);
                      }
                    } catch (e) {
                      // Ignore parsing errors (user might be in the middle of typing)
                    }
                  }}
                  placeholder={`[
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255]
]`}
                  className="mt-2 font-mono text-sm"
                  rows={Math.min(currentPalette.length + 2, 20)}
                />
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <Label>Source Image</Label>
                <div
                  className="mt-2 border rounded-lg overflow-hidden relative"
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  style={dropZoneStyle}
                >
                  <canvas
                    ref={sourceCanvasRef}
                    className="w-full h-auto"
                    style={{ imageRendering: "auto" }}
                  />
                  <div style={overlayStyle}>
                    <span className="text-sm text-gray-600">
                      Drag and drop an image
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <Label>Result</Label>
                <div className="mt-2 border rounded-lg overflow-hidden bg-grid">
                  <canvas
                    ref={resultCanvasRef}
                    className="w-full h-auto"
                    style={{
                      imageRendering: "pixelated",
                      background: "transparent",
                    }}
                  />
                </div>
                <Button
                  className="mt-2 w-full"
                  onClick={() => {
                    const canvas = resultCanvasRef.current;
                    if (!canvas) return;

                    const link = document.createElement("a");
                    link.download = "pixel-art.png";
                    link.href = canvas.toDataURL("image/png");
                    link.click();
                  }}
                >
                  Download PNG
                </Button>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export { PicPixellerComponent };
