import type {Metadata} from "next";

import {NotFoundView} from "../components/not-found-view";
import {SiteNav} from "../components/site-nav";

export const metadata: Metadata = {title: "Page not found | Tessom", robots: {index: false}};

/** Unknown URLs. These sit outside the site layout, so this page brings its own nav. */
export default function NotFound() {
  return (
    <>
      <SiteNav />
      <NotFoundView />
    </>
  );
}
