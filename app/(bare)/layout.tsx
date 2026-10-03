import {SiteNav} from "../../components/site-nav";

/** Pages that end without the footer. */
export default function BareLayout({children}: Readonly<{children: React.ReactNode}>) {
  return (
    <>
      <SiteNav />
      <div id="main" className="flex-1">
        {children}
      </div>
    </>
  );
}
