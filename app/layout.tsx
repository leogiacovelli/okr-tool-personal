import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OKR · Your Company",
  description: "Semi-annual objectives management for the Marketing team",
  robots: { index: false, follow: false },
};

// Initialize the theme before paint to avoid a light/dark flash.
const themeScript = `(function(){try{var t=localStorage.getItem("theme");if(!t){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      {/* suppressHydrationWarning: browser extensions (e.g. ColorZilla)
          inject attributes on body before React hydrates */}
      <body className="min-h-screen antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
