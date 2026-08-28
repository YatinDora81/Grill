import type { MetadataRoute } from "next";
import { config } from "@/lib/env";

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
      url: `${config.site.url}/tools/resume-vs-jd`,
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
