import {useId} from "react";

import type {Placement, Rect} from "../lib/offers";

export interface CutPlanPiece extends Placement {
  /** Piece name, such as "Front panel". */
  label: string;
  /** Finished size in cm, without seam allowance. */
  wCm: number;
  hCm: number;
}

export interface CutPlanOffer {
  id: string;
  pieces: readonly CutPlanPiece[];
}

export interface CutPlanProps {
  widthCm: number;
  heightCm: number;
  /** Sized image URL of the fabric photo. */
  photoUrl: string | null;
  /** Describes the plan for screen readers. */
  ariaLabel: string;
  defects?: readonly Rect[];
  /** Areas already sold. They are filled and stamped. */
  allocations?: readonly Rect[];
  offers?: readonly CutPlanOffer[];
  /** When set, this offer is drawn solid and the others fade back. */
  activeOfferId?: string | null;
  /** Piece labels. Auto shows them for the active offer, or when only one offer is drawn. */
  labels?: "auto" | "all" | "none";
  className?: string;
}

const GRID_CM = 10;
const DASHES = ["7 4", "2 3", "11 3 2 3"] as const;

function pct(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}

function formatCm(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function CutPlan({
  widthCm,
  heightCm,
  photoUrl,
  ariaLabel,
  defects = [],
  allocations = [],
  offers = [],
  activeOfferId = null,
  labels = "auto",
  className = "",
}: CutPlanProps) {
  const uid = useId().replace(/:/g, "");
  const gridId = `grid-${uid}`;
  const hatchId = `hatch-${uid}`;
  const dimmed = activeOfferId !== null && offers.some((offer) => offer.id === activeOfferId);
  const labelled = (offer: CutPlanOffer): boolean =>
    labels === "all" || (labels === "auto" && (offer.id === activeOfferId || (offers.length === 1 && !dimmed)));
  const stampArea = allocations.reduce<Rect | null>((best, area) => (best === null || area.w * area.h > best.w * best.h ? area : best), null);

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className={`relative w-full overflow-hidden rounded-card bg-recessed ${className}`}
      style={{aspectRatio: `${widthCm} / ${heightCm}`}}
    >
      <svg
        viewBox={`0 0 ${widthCm} ${heightCm}`}
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        <defs>
          <pattern id={gridId} width={GRID_CM} height={GRID_CM} patternUnits="userSpaceOnUse">
            <path d={`M${GRID_CM} 0H0V${GRID_CM}`} fill="none" stroke="#000000" strokeOpacity="0.14" strokeWidth="0.3" />
            <path d={`M${GRID_CM} 0H0V${GRID_CM}`} fill="none" stroke="#ffffff" strokeOpacity="0.5" strokeWidth="0.15" />
          </pattern>
          <pattern id={hatchId} width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="3" height="3" fill="#ffffff" fillOpacity="0.4" />
            <line x1="0" y1="0" x2="0" y2="3" stroke="#000000" strokeWidth="0.7" />
          </pattern>
        </defs>

        {photoUrl && <image href={photoUrl} x="0" y="0" width={widthCm} height={heightCm} preserveAspectRatio="xMidYMid slice" />}
        <rect width={widthCm} height={heightCm} fill={`url(#${gridId})`} />

        {defects.map((defect, index) => (
          <rect
            key={`defect-${index}`}
            x={defect.x}
            y={defect.y}
            width={defect.w}
            height={defect.h}
            fill={`url(#${hatchId})`}
            stroke="#000000"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {allocations.map((area, index) => (
          <rect key={`sold-${index}`} x={area.x} y={area.y} width={area.w} height={area.h} fill="#000000" fillOpacity="0.6" />
        ))}

        {offers.map((offer, offerIndex) => {
          const active = offer.id === activeOfferId;
          const faded = dimmed && !active;
          return (
            <g key={offer.id} opacity={faded ? 0.25 : 1}>
              {offer.pieces.map((piece, pieceIndex) => (
                <g key={pieceIndex}>
                  <rect
                    x={piece.x}
                    y={piece.y}
                    width={piece.w}
                    height={piece.h}
                    fill="none"
                    stroke="#ffffff"
                    strokeOpacity="0.75"
                    strokeWidth={active ? 4.5 : 3.5}
                    vectorEffect="non-scaling-stroke"
                  />
                  <rect
                    x={piece.x}
                    y={piece.y}
                    width={piece.w}
                    height={piece.h}
                    fill="#3b6ea5"
                    fillOpacity={active ? 0.28 : 0.12}
                    stroke="#3b6ea5"
                    strokeWidth={active ? 2.5 : 1.5}
                    strokeDasharray={active ? undefined : DASHES[offerIndex % DASHES.length]}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              ))}
            </g>
          );
        })}
      </svg>

      {offers.filter(labelled).flatMap((offer) => {
        const faded = false;
        return offer.pieces.map((piece, pieceIndex) => (
          <span
            key={`${offer.id}-${pieceIndex}`}
            aria-hidden="true"
            className="pointer-events-none absolute overflow-hidden text-ellipsis whitespace-nowrap rounded-[4px] bg-paper/90 px-1.5 font-mono text-[11px] leading-[18px] text-ink"
            style={{
              left: pct(piece.x, widthCm),
              top: pct(piece.y, heightCm),
              maxWidth: `calc(${pct(piece.w, widthCm)} - 8px)`,
              margin: "4px 0 0 4px",
              opacity: faded ? 0.25 : 1,
            }}
          >
            {piece.label} {formatCm(piece.wCm)}×{formatCm(piece.hCm)}
          </span>
        ));
      })}

      {stampArea && [stampArea].map((area, index) => (
        <span
          key={`stamp-${index}`}
          aria-hidden="true"
          className="pointer-events-none absolute flex items-center justify-center overflow-hidden font-stamp text-[28px] uppercase leading-none text-stamp"
          style={{
            left: pct(area.x, widthCm),
            top: pct(area.y, heightCm),
            width: pct(area.w, widthCm),
            height: pct(area.h, heightCm),
          }}
        >
          <span className="-rotate-[4deg] border border-stamp/40 px-3 py-1">Sold</span>
        </span>
      ))}
    </div>
  );
}
