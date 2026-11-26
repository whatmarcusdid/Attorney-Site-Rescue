import { CRAWLER_INFO_URL, SUPPORT_EMAIL } from "../identity";

/**
 * Crawler identity.
 *
 * Outbound page loads should send this User-Agent: a product token, a page
 * that explains the crawler, and an address a site owner can use. The token
 * and the info URL are placeholders. The mailbox is the product inbox.
 */
export const CRAWLER_USER_AGENT = `AttorneySiteRescueBot/0.1-placeholder (+${CRAWLER_INFO_URL}; ${SUPPORT_EMAIL})`;

/**
 * Product token matched against robots.txt User-agent groups.
 * Lowercased for comparison; robots.txt matching is case-insensitive.
 */
export const CRAWLER_PRODUCT_TOKEN = "attorneysiterescuebot";
