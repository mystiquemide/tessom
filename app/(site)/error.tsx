"use client";

import {ErrorView} from "../../components/error-view";

export default function SiteError({reset}: {error: Error & {digest?: string}; reset: () => void}) {
  return <ErrorView reset={reset} />;
}
