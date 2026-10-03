import {ImageResponse} from "next/og";

export const alt = "Tessom. Every offcut has a next piece.";
export const size = {width: 1200, height: 630};
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#fdfcf5",
          padding: "72px 80px",
          color: "#000000",
        }}
      >
        <div style={{display: "flex", alignItems: "center", gap: 20}}>
          <svg width="76" height="76" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="7" fill="#000000" />
            <rect x="7" y="8" width="18" height="6" rx="1" fill="#fdfcf5" />
            <rect x="13" y="16" width="6" height="9" rx="1" fill="#fdfcf5" />
          </svg>
          <div style={{fontSize: 44, fontWeight: 600, letterSpacing: -1}}>Tessom</div>
        </div>

        <div style={{display: "flex", flexDirection: "column"}}>
          <div style={{fontSize: 88, fontWeight: 700, lineHeight: 1.08, letterSpacing: -3, maxWidth: 980}}>Every offcut has a next piece.</div>
          <div style={{marginTop: 28, fontSize: 32, lineHeight: 1.4, color: "#4c4c4a", maxWidth: 880}}>
            Premium upholstery fabric, cut into one-off cushions, pads and totes from what the workshop had left.
          </div>
        </div>

        <div style={{display: "flex", gap: 12}}>
          {["Cushions", "Bench pads", "Lumbar cushions", "Seat pads", "Totes"].map((label) => (
            <div key={label} style={{display: "flex", padding: "10px 22px", borderRadius: 9999, background: "#ffffff", border: "2px solid #e5e2d0", fontSize: 24}}>
              {label}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
