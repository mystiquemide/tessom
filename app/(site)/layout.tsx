import {SiteNav} from "../../components/site-nav";

/** The nav on every page. Only the landing page adds the footer. */
export default function SiteLayout({children}: Readonly<{children: React.ReactNode}>) {
  return (
    <>
      <SiteNav />
      <div id="main" className="flex-1">
        {children}
      </div>
    </>
  );
}
