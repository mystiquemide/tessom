import {SiteNav} from "../../components/site-nav";

/** The nav on every page. Each page renders its own main region, and only the landing page adds the footer after it. */
export default function SiteLayout({children}: Readonly<{children: React.ReactNode}>) {
  return (
    <>
      <SiteNav />
      {children}
    </>
  );
}
