import type {Metadata} from "next";
import {Fraunces, Inter, JetBrains_Mono} from "next/font/google";

import {SiteFooter} from "../components/site-footer";
import {SiteNav} from "../components/site-nav";
import "./globals.css";

const fraunces = Fraunces({subsets: ["latin"], variable: "--font-fraunces", axes: ["opsz"]});
const inter = Inter({subsets: ["latin"], variable: "--font-inter"});
const jetbrains = JetBrains_Mono({subsets: ["latin"], variable: "--font-jetbrains"});

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Tessom",
  description: "Every offcut has a next piece.",
};

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable} ${jetbrains.variable}`}>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded-pill focus:bg-ink focus:px-4 focus:py-2 focus:text-paper">
          Skip to content
        </a>
        <SiteNav />
        <div id="main" className="flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
