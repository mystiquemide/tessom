import type {Metadata} from "next";
import {Fraunces, Grenze_Gotisch, Inter, JetBrains_Mono} from "next/font/google";

import "./globals.css";

const fraunces = Fraunces({subsets: ["latin"], variable: "--font-fraunces", axes: ["opsz"]});
const inter = Inter({subsets: ["latin"], variable: "--font-inter"});
const grenze = Grenze_Gotisch({subsets: ["latin"], variable: "--font-stamp", weight: ["700"]});
const jetbrains = JetBrains_Mono({subsets: ["latin"], variable: "--font-jetbrains"});

export const revalidate = 3600;

const DESCRIPTION = "Premium upholstery fabric, cut into one-off cushions, pads and totes from what the workshop had left.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000"),
  title: "Tessom",
  description: DESCRIPTION,
  openGraph: {title: "Tessom. Every offcut has a next piece.", description: DESCRIPTION, siteName: "Tessom", type: "website"},
  twitter: {card: "summary_large_image", title: "Tessom. Every offcut has a next piece.", description: DESCRIPTION},
};

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable} ${jetbrains.variable} ${grenze.variable}`}>
      <body>
        {children}
      </body>
    </html>
  );
}
