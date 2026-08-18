import type { MetadataRoute } from "next";

// Internal tool: no page should be indexed.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" },
  };
}
