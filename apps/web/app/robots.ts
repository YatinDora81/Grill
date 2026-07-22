import type { MetadataRoute } from "next";
import { config } from "@/lib/env";

/**
 * Stops the crawl before the fetch. The per-page `robots: { index: false }` only
 * works once a crawler has already downloaded the HTML — for `/report/<id>` and
 * `/session/<id>`, whose URLs leak through referrers and shared links, keeping
 * the fetch from happening at all is the stronger guarantee.
 *
 * Google resolves the most specific matching rule, so the broad `allow: "/"`
 * does not re-open anything listed below it.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/signup"],
      disallow: [
        "/api/",
        "/dashboard",
        "/login",
        "/new",
        "/profile",
        "/report/",
        "/session/",
        "/starred",
      ],
    },
    sitemap: `${config.site.url}/sitemap.xml`,
  };
}
