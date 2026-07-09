import type { MetadataRoute } from "next";

// Tool interno: nessuna pagina indicizzabile.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" },
  };
}
