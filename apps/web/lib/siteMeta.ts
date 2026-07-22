/**
 * The words the product uses to describe itself, in one place.
 *
 * The tagline and pitch are quoted in at least four independent surfaces — the
 * <title>, the meta description, the Open Graph card, and the generated OG
 * image — and search engines treat a page whose title and og:title disagree as
 * a weaker signal than either alone. One constant means they cannot drift.
 *
 * Deliberately not `server-only`, and it must never import `env`: this is plain
 * copy, and pulling server config in here would put it in the client bundle for
 * any component that wants the product name.
 */

export const SITE_NAME = "Grill";

/** The <title> for the landing page, and the OG title everywhere it isn't overridden. */
export const SITE_TAGLINE = "Grill — mock interviews that tell you the truth";

/**
 * ~155 chars: Google truncates the description snippet around there, and a
 * sentence cut mid-clause reads worse than a shorter one that lands.
 */
export const SITE_DESCRIPTION =
  "AI mock interviews that ask real follow-ups and score how you actually sound. Composure under heat.";

/** 1200x630 is the ratio every scraper crops to; anything else gets letterboxed. */
export const OG_IMAGE_SIZE = { width: 1200, height: 630 };

export const OG_IMAGE_ALT = `${SITE_NAME} — ${SITE_DESCRIPTION}`;

/**
 * The OG image, spelled out so a page can restate it.
 *
 * `app/opengraph-image.tsx` normally attaches itself to every descendant route
 * for free — but a segment that declares its own `openGraph` object REPLACES the
 * inherited one wholesale, image included. So any page overriding og:title (the
 * landing page, signup) must hand this back or it ships a card with no picture,
 * which is the failure mode you only notice after someone shares the link.
 *
 * Points at the route without the build hash Next appends: the hash is cache
 * busting, and `/opengraph-image` serves the same PNG either way.
 */
export const OG_IMAGE = {
  url: "/opengraph-image",
  ...OG_IMAGE_SIZE,
  alt: OG_IMAGE_ALT,
};

export const SITE_KEYWORDS = [
  "mock interview",
  "AI interview practice",
  "interview preparation",
  "technical interview",
  "behavioral interview",
  "interview feedback",
  "resume interview",
  "system design interview",
];
