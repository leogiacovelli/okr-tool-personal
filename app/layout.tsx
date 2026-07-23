import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OKR · La Tua Azienda",
  description: "Gestione obiettivi semestrali del team Marketing",
  robots: { index: false, follow: false },
};

// Inizializza il tema prima del paint per evitare flash chiaro/scuro.
const themeScript = `(function(){try{var t=localStorage.getItem("theme");if(!t){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      {/* suppressHydrationWarning: le estensioni del browser (es. ColorZilla)
          iniettano attributi sul body prima che React si avvii */}
      <body className="min-h-screen antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
