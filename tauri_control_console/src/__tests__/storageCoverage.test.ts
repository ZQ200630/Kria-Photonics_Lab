import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const projectRoot = join(__dirname, "..", "..");
const runtimeRoots = [join(__dirname, "..", "components"), join(__dirname, "..", "utils")];
const runtimeFiles = [join(projectRoot, "src-tauri", "src", "main.rs")];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|rs)$/.test(name) ? [path] : [];
  });
}

describe("storage coverage", () => {
  it("does not use legacy experiment save helpers in runtime components", () => {
    const patterns = [
      /saveExperimentBundle\(/,
      /chooseDataDirectory\(/,
      /saveTextFile\(/,
      /\/tmp\/pa_capture\.bin/,
      /livePreviewImage\?\.path/,
      /disabled=\{!paCurrentSourcePath\}/,
      /Idle_Spectrum/,
      /Lock_Spectrum/,
      /Live PD Monitor/,
    ];
    const matches = [...runtimeRoots.flatMap(sourceFiles), ...runtimeFiles]
      .filter((path) => !path.endsWith("utils/storage.ts"))
      .flatMap((path) => {
        const lines = readFileSync(path, "utf8").split("\n");
        return lines.flatMap((line, index) =>
          patterns.some((pattern) => pattern.test(line)) ? [`${relative(projectRoot, path)}:${index + 1}: ${line.trim()}`] : [],
        );
      });

    expect(matches).toEqual([]);
  });
});
