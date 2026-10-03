import {SiteFooter} from "../../components/site-footer";
import {SiteNav} from "../../components/site-nav";

export default function SiteLayout({children}: Readonly<{children: React.ReactNode}>) {
  return (
    <>
      <SiteNav />
      <div id="main" className="flex-1">
        {children}
      </div>
      <SiteFooter />
    </>
  );
}
