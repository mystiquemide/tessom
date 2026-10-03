import type {Metadata} from "next";

import {NotFoundView} from "../../components/not-found-view";

export const metadata: Metadata = {title: "Page not found | Tessom", robots: {index: false}};

/** A piece, owner or order that does not exist. The site layout supplies the nav. */
export default function NotFound() {
  return <NotFoundView />;
}
