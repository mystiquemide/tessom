"use client";

/** Last resort when the root layout itself fails. It cannot use the site fonts or components. */
export default function GlobalError({reset}: {error: Error & {digest?: string}; reset: () => void}) {
  return (
    <html lang="en">
      <body style={{margin: 0, background: "#fdfcf5", color: "#000000", fontFamily: "system-ui, sans-serif"}}>
        <main style={{maxWidth: 560, margin: "0 auto", padding: "96px 24px", textAlign: "center"}}>
          <h1 style={{fontFamily: "Georgia, serif", fontWeight: 400, fontSize: 36, lineHeight: 1.25, margin: 0}}>Something went wrong on our side.</h1>
          <p style={{color: "#4c4c4a", lineHeight: 1.63}}>This page didn&apos;t load. Nothing was ordered or changed by this error.</p>
          <button type="button" onClick={reset} style={{marginTop: 24, background: "#000000", color: "#ffffff", border: 0, borderRadius: 9999, padding: "8px 20px", fontSize: 16, fontWeight: 600, cursor: "pointer"}}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
