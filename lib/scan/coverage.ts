/**
 * Coverage for a home page plus the expected category pages.
 *
 * A category page recorded as not found (no link discovered) is absent, not
 * an omission. Any other unread expected page is an omission. The terminal
 * state is partial when the home page was not assessed or when any omission
 * remains. It is complete only when the home page was assessed and every
 * linked expected page was read.
 */

export const CATEGORY_PAGE_TYPES = ["about", "services", "contact"] as const;

export type CategoryPageType = (typeof CATEGORY_PAGE_TYPES)[number];

/** Home plus the category pages a full read would include. */
export const EXPECTED_PAGE_TYPES = ["home", ...CATEGORY_PAGE_TYPES] as const;

export interface ScanPageRecord {
  pageType: string;
  url?: string | null;
  assessed?: boolean;
  /** True when no link to this page type was discovered. */
  notFound?: boolean;
  reasonCode?: string | null;
}

export interface PageOmission {
  pageType: string;
  url: string | null;
  reasonCode: string;
}

export interface CoverageAssessment {
  homeAssessed: boolean;
  assessedPageTypes: string[];
  /** Expected pages that were not read. These make the terminal state partial. */
  omissions: PageOmission[];
  /**
   * Expected page types the site does not have. They are not omissions:
   * a page that was never linked was not left unread.
   */
  absentPageTypes: string[];
  expectedPageCount: number;
}

export type CoverageTerminalState = "partial" | "complete";

function findPage(
  pages: readonly ScanPageRecord[],
  pageType: string,
): ScanPageRecord | undefined {
  return pages.find((page) => page.pageType === pageType);
}

function isAssessed(page: ScanPageRecord | undefined): boolean {
  return page?.assessed === true;
}

function isAbsent(page: ScanPageRecord | undefined): boolean {
  return page?.notFound === true;
}

function omissionReason(page: ScanPageRecord | undefined): string {
  if (!page) return "NOT_STORED";
  const reason = page.reasonCode;
  return typeof reason === "string" && reason ? reason : "NOT_ASSESSED";
}

export function assessPageCoverage(
  pages: readonly ScanPageRecord[],
): CoverageAssessment {
  const home = findPage(pages, "home");
  const assessedPageTypes: string[] = [];
  const omissions: PageOmission[] = [];
  const absentPageTypes: string[] = [];

  if (isAssessed(home)) assessedPageTypes.push("home");

  for (const pageType of CATEGORY_PAGE_TYPES) {
    const page = findPage(pages, pageType);
    if (isAssessed(page)) {
      assessedPageTypes.push(pageType);
      continue;
    }
    if (isAbsent(page)) {
      absentPageTypes.push(pageType);
      continue;
    }
    omissions.push({
      pageType,
      url: page?.url ?? null,
      reasonCode: omissionReason(page),
    });
  }

  return {
    homeAssessed: isAssessed(home),
    assessedPageTypes,
    omissions,
    absentPageTypes,
    expectedPageCount: CATEGORY_PAGE_TYPES.length + 1,
  };
}

export function resolveTerminalState(
  coverage: CoverageAssessment,
): CoverageTerminalState {
  if (!coverage.homeAssessed) return "partial";
  if (coverage.omissions.length > 0) return "partial";
  return "complete";
}
