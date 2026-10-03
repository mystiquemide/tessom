import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tessom",
  description: "Every offcut has a next piece.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
