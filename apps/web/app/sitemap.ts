import type { MetadataRoute } from "next";
import { config } from "@/lib/env";

/**
 * Three entries, because three pages are public. Everything else is behind auth
 * or keyed to one candidate's session.
 *
 * No `lastModified`: it would have to be stamped at build time, which reports
 * every page as changed on every deploy. Crawlers that catch a sitemap lying
 * about freshness discount the whole file, so saying nothing beats saying "now".
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${config.site.url}/`,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${config.site.url}/sample`,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${config.site.url}/signup`,
      changeFrequency: "monthly",
      priority: 0.8,
    },
  ];
}
