import type {Metadata} from "next";
import {Fraunces, Grenze_Gotisch, Inter, JetBrains_Mono} from "next/font/google";

import "./globals.css";

const fraunces = Fraunces({subsets: ["latin"], variable: "--font-fraunces", axes: ["opsz"]});
const inter = Inter({subsets: ["latin"], variable: "--font-inter"});
const grenze = Grenze_Gotisch({subsets: ["latin"], variable: "--font-stamp", weight: ["700"]});
const jetbrains = JetBrains_Mono({subsets: ["latin"], variable: "--font-jetbrains"});

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Tessom",
  description: "Every offcut has a next piece.",
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
