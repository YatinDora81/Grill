import type { MetadataRoute } from "next";
import { config } from "@/lib/env";

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
