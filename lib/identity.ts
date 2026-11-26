/**
 * Public identity. Single source for the product name, the crawler contact
 * address, and the transactional From address.
 *
 * SUPPORT_EMAIL and DEFAULT_FROM_EMAIL are the product inbox. CRAWLER_INFO_URL
 * stays a placeholder until a page exists that explains the crawler.
 */

/** Product name, for anything describing what the customer is using. */
export const PRODUCT_NAME = "Attorney Site Rescue";

/** Placeholder. Not a live page that explains the crawler. */
export const CRAWLER_INFO_URL =
  "https://example.com/attorney-site-rescue/crawler-info-placeholder";

/** Product inbox. Site owners and mail replies use this address. */
export const SUPPORT_EMAIL = "audit@attorneysiterescue.com";

/** Default transactional From address. Same inbox as SUPPORT_EMAIL. */
export const DEFAULT_FROM_EMAIL = "audit@attorneysiterescue.com";
