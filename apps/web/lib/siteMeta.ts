export const SITE_NAME = "Grill";

export const SITE_TAGLINE = "Grill — mock interviews that tell you the truth";

export const SITE_DESCRIPTION =
  "AI mock interviews that ask real follow-ups and score how you actually sound. Composure under heat.";

export const OG_IMAGE_SIZE = { width: 1200, height: 630 };

export const OG_IMAGE_ALT = `${SITE_NAME} — ${SITE_DESCRIPTION}`;

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
