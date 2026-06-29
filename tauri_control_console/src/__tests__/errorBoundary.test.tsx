import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorBoundaryFallback, messageFromUnknownError } from "../components/ErrorBoundary";

describe("UI error boundary", () => {
  it("renders a readable fallback instead of an empty panel", () => {
    const html = renderToStaticMarkup(
      <ErrorBoundaryFallback title="PA Image Viewer crashed" error={new Error("viewer failed")} resetLabel="Back" onReset={() => undefined} />,
    );

    expect(html).toContain("PA Image Viewer crashed");
    expect(html).toContain("viewer failed");
    expect(html).toContain("Back");
  });

  it("formats non-Error thrown values", () => {
    expect(messageFromUnknownError("plain failure")).toBe("plain failure");
    expect(messageFromUnknownError({ code: 7 })).toBe('{"code":7}');
  });
});
