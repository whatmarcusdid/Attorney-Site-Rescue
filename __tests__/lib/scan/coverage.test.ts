/**
 * @jest-environment node
 */
import {
  assessPageCoverage,
  resolveTerminalState,
  type ScanPageRecord,
} from "@/lib/scan/coverage";

const HOME = "https://example.com/";

function assessed(pageType: string, url: string): ScanPageRecord {
  return { pageType, url, assessed: true };
}

describe("page coverage", () => {
  it("resolves partial when an expected page was not read", () => {
    const coverage = assessPageCoverage([
      assessed("home", HOME),
      assessed("about", "https://example.com/about"),
      assessed("services", "https://example.com/services"),
      {
        pageType: "contact",
        url: "https://example.com/contact",
        assessed: false,
        reasonCode: "FETCH_TIMEOUT",
      },
    ]);

    expect(resolveTerminalState(coverage)).toBe("partial");
    expect(coverage.omissions).toEqual([
      {
        pageType: "contact",
        url: "https://example.com/contact",
        reasonCode: "FETCH_TIMEOUT",
      },
    ]);
  });

  it("resolves complete when every linked page was read", () => {
    const coverage = assessPageCoverage([
      assessed("home", HOME),
      assessed("about", "https://example.com/about"),
      assessed("services", "https://example.com/services"),
      assessed("contact", "https://example.com/contact"),
    ]);

    expect(resolveTerminalState(coverage)).toBe("complete");
    expect(coverage.homeAssessed).toBe(true);
    expect(coverage.omissions).toEqual([]);
    expect(coverage.assessedPageTypes).toEqual([
      "home",
      "about",
      "services",
      "contact",
    ]);
  });

  it("does not call a missing page type an omission when no link was found", () => {
    const coverage = assessPageCoverage([
      assessed("home", HOME),
      { pageType: "about", notFound: true },
      { pageType: "services", notFound: true },
      { pageType: "contact", notFound: true },
    ]);

    expect(resolveTerminalState(coverage)).toBe("complete");
    expect(coverage.omissions).toEqual([]);
    expect(coverage.absentPageTypes).toEqual(["about", "services", "contact"]);
  });

  it("resolves partial when the home page was not assessed", () => {
    const coverage = assessPageCoverage([
      { pageType: "home", url: HOME, assessed: false },
      assessed("about", "https://example.com/about"),
      assessed("services", "https://example.com/services"),
      assessed("contact", "https://example.com/contact"),
    ]);

    expect(coverage.homeAssessed).toBe(false);
    expect(resolveTerminalState(coverage)).toBe("partial");
    expect(resolveTerminalState(coverage)).not.toBe("complete");
  });
});
