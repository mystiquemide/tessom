import type {Metadata} from "next";

import {WorkshopBoard} from "../../../components/workshop-board";

export const metadata: Metadata = {
  title: "Workshop | Tessom",
  description: "The workshop board.",
  robots: {index: false, follow: false},
};

export default function WorkshopPage() {
  return <WorkshopBoard />;
}
