import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PaImageViewer from "../components/PaImageViewer";

describe("PA Image Viewer layout", () => {
  it("renders source controls, ROI controls, trace, and image preview", () => {
    const html = renderToStaticMarkup(<PaImageViewer active tzOhm={2000} onBack={() => undefined} />);

    expect(html).toContain("PA Image Viewer");
    expect(html).toContain("Open Legacy Bin");
    expect(html).toContain("Build Image");
    expect(html).toContain("PTP ROI");
    expect(html).toContain("Frame Trace");
    expect(html).toContain("PA Image");
    expect(html).toContain("Zoom");
    expect(html).toContain("Set ROI");
  });
});
