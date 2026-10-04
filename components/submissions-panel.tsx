"use client";

import Image from "next/image";
import {useEffect, useRef, useState} from "react";

import type {SubmissionCard} from "../lib/submissions/review";

interface Accepted {
  ownerLink: string | null;
  contact: {name: string; email: string};
}

type CardState =
  | {phase: "idle"}
  | {phase: "busy"}
  | {phase: "accepted"; accepted: Accepted}
  | {phase: "declined"}
  | {phase: "error"; message: string};

function SubmissionItem({
  card,
  pin,
  onChanged,
  onLocked,
}: {
  card: SubmissionCard;
  pin: string;
  onChanged: () => void;
  onLocked: () => void;
}) {
  const [value, setValue] = useState("");
  const [fabricName, setFabricName] = useState(card.title === "Unnamed fabric" ? "" : card.title);
  const [maker, setMaker] = useState("");
  const [vCm, setVCm] = useState("");
  const [hCm, setHCm] = useState("");
  const [directional, setDirectional] = useState(card.directional);
  const [reading, setReading] = useState<{phase: "idle" | "busy" | "failed"} | {phase: "shown"; confidence: string; evidence: string}>({phase: "idle"});
  const [state, setState] = useState<CardState>({phase: "idle"});
  const [copied, setCopied] = useState(false);

  async function send(path: string, body: unknown): Promise<Response | null> {
    setState({phase: "busy"});
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: {"content-type": "application/json", "x-workshop-pin": pin},
        body: JSON.stringify(body),
      });
      if (response.status === 401) {
        onLocked();
        return null;
      }
      return response;
    } catch {
      setState({phase: "error", message: "Couldn't reach the workshop. Try again."});
      return null;
    }
  }

  async function readSelvage() {
    setReading({phase: "busy"});
    try {
      const response = await fetch("/api/workshop/submissions/read-selvage", {
        method: "POST",
        headers: {"content-type": "application/json", "x-workshop-pin": pin},
        body: JSON.stringify({submissionId: card.id}),
      });
      if (response.status === 401) return onLocked();
      if (!response.ok) return setReading({phase: "failed"});
      const found = (await response.json()) as {
        fabricName: string | null;
        maker: string | null;
        repeatVerticalCm: number | null;
        repeatHorizontalCm: number | null;
        directional: boolean | null;
        confidence: string;
        evidence: string;
      };
      // Suggestions only fill the fields. The workshop still reviews and presses Accept.
      if (found.fabricName) setFabricName(found.fabricName);
      if (found.maker) setMaker(found.maker);
      if (found.repeatVerticalCm) setVCm(String(found.repeatVerticalCm));
      if (found.repeatHorizontalCm) setHCm(String(found.repeatHorizontalCm));
      // A printed direction arrow is evidence the pattern runs one way. Never switch it off automatically.
      if (found.directional === true) setDirectional(true);
      setReading({phase: "shown", confidence: found.confidence, evidence: found.evidence});
    } catch {
      setReading({phase: "failed"});
    }
  }

  async function accept() {
    const valuePerM = Number(value);
    if (!Number.isFinite(valuePerM) || valuePerM <= 0) {
      setState({phase: "error", message: "Enter what this fabric is worth per metre."});
      return;
    }
    const v = Number(vCm);
    const h = Number(hCm);
    const repeat = {...(v > 0 ? {vCm: v} : {}), ...(h > 0 ? {hCm: h} : {})};
    const response = await send("/api/workshop/submissions/accept", {
      submissionId: card.id,
      valuePerM,
      directional,
      ...(fabricName.trim() ? {fabricName: fabricName.trim()} : {}),
      ...(maker.trim() ? {maker: maker.trim()} : {}),
      ...(Object.keys(repeat).length > 0 ? {repeat} : {}),
    });
    if (!response) return;
    if (response.ok) {
      const body = (await response.json()) as {ownerLink: string | null; contact: {name: string; email: string}};
      setState({phase: "accepted", accepted: {ownerLink: body.ownerLink, contact: body.contact}});
      onChanged();
      return;
    }
    const error = ((await response.json().catch(() => ({}))) as {error?: string}).error;
    setState({phase: "error", message: error ?? "Couldn't accept this offer. Try again."});
  }

  async function decline() {
    const response = await send("/api/workshop/submissions/decline", {submissionId: card.id});
    if (!response) return;
    if (response.ok) {
      setState({phase: "declined"});
      onChanged();
      return;
    }
    setState({phase: "error", message: "Couldn't decline this offer. Try again."});
  }

  if (state.phase === "declined") {
    return <li className="rounded-card bg-paper p-3 text-[14px] text-body shadow-card">Declined {card.title}.</li>;
  }

  if (state.phase === "accepted") {
    const {accepted} = state;
    const url = accepted.ownerLink && typeof window !== "undefined" ? `${window.location.origin}${accepted.ownerLink}` : accepted.ownerLink;
    return (
      <li className="rounded-card bg-paper p-3 shadow-card">
        <h3 className="font-serif text-[16px] font-medium text-ink">{fabricName.trim() || card.title} is in Awaiting consent.</h3>
        <p className="mt-1 text-[14px] leading-[1.71] text-body">Send this owner link to the submitter. It is the only way they can approve.</p>
        <div className="mt-2 rounded-[4px] bg-recessed p-2 font-mono text-[13px] leading-[1.5] text-ink">
          <p>{accepted.contact.name}</p>
          <p className="break-all">{accepted.contact.email}</p>
        </div>
        {url && (
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
              } catch {
                // Clipboard can be blocked. The link also sits on the Awaiting consent card.
              }
            }}
            className="mt-2 rounded-pill bg-paper px-3 py-1.5 text-[14px] font-semibold text-ink shadow-hairline hover:shadow-card"
          >
            {copied ? "Link copied" : "Copy owner link"}
          </button>
        )}
      </li>
    );
  }

  const busy = state.phase === "busy";
  return (
    <li className="rounded-card bg-paper p-3 shadow-card">
      <div className="flex gap-2.5">
        {card.photoUrl && <Image src={card.photoUrl} alt="" width={64} height={64} className="size-16 shrink-0 rounded-[4px] bg-recessed object-cover" />}
        <div className="min-w-0">
          <h3 className="font-serif text-[16px] font-medium leading-[1.3] text-ink">{card.title}</h3>
          <p className="mt-0.5 font-mono text-[13px] leading-[1.5] text-muted">{card.firstName} · ref {card.reference.slice(0, 6)}</p>
        </div>
      </div>
      <p className="mt-2 font-mono text-[13px] leading-[1.5] text-body">{card.details.join(" · ")}</p>
      {card.notes && <p className="mt-2 text-[14px] leading-[1.71] text-body">{card.notes}</p>}
      <div className="mt-3">
        <button type="button" disabled={reading.phase === "busy"} onClick={() => void readSelvage()} className="w-full rounded-pill bg-paper px-3 py-1.5 text-[14px] font-semibold text-ink shadow-hairline hover:shadow-card disabled:text-warm-gray">
          {reading.phase === "busy" ? "Reading the selvage…" : "Read selvage photo"}
        </button>
        {reading.phase === "failed" && <p role="alert" className="mt-2 text-[13px] leading-[1.5] text-ink">Couldn&apos;t read this photo. Type the details by hand.</p>}
        {reading.phase === "shown" && (
          <p className="mt-2 text-[13px] leading-[1.5] text-body">
            <span className="font-semibold text-ink">{reading.confidence} confidence.</span> {reading.evidence} Check the fields below before you accept.
          </p>
        )}
      </div>
      <label className="mt-3 block text-[13px] font-semibold text-ink">
        Fabric name
        <input value={fabricName} onChange={(event) => setFabricName(event.target.value)} maxLength={160} className="mt-1 w-full rounded-card border border-charcoal bg-paper px-3 py-2 text-[14px] text-ink" />
      </label>
      <label className="mt-3 block text-[13px] font-semibold text-ink">
        Maker
        <input value={maker} onChange={(event) => setMaker(event.target.value)} maxLength={160} className="mt-1 w-full rounded-card border border-charcoal bg-paper px-3 py-2 text-[14px] text-ink" />
      </label>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block text-[13px] font-semibold text-ink">
          Repeat up (cm)
          <input value={vCm} onChange={(event) => setVCm(event.target.value)} inputMode="decimal" className="mt-1 w-full rounded-card border border-charcoal bg-paper px-3 py-2 text-[14px] text-ink" />
        </label>
        <label className="block text-[13px] font-semibold text-ink">
          Repeat across (cm)
          <input value={hCm} onChange={(event) => setHCm(event.target.value)} inputMode="decimal" className="mt-1 w-full rounded-card border border-charcoal bg-paper px-3 py-2 text-[14px] text-ink" />
        </label>
      </div>
      <label className="mt-3 flex items-center gap-2 text-[13px] font-semibold text-ink">
        <input type="checkbox" checked={directional} onChange={(event) => setDirectional(event.target.checked)} className="size-4" />
        Directional (the pattern runs one way)
      </label>
      <label className="mt-3 block text-[13px] font-semibold text-ink">
        Value per metre
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          inputMode="decimal"
          className="mt-1 w-full rounded-card border border-charcoal bg-paper px-3 py-2 text-[14px] text-ink"
        />
      </label>
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={busy} onClick={() => void accept()} className="flex-1 rounded-pill bg-ink px-3 py-1.5 text-[14px] font-semibold text-paper disabled:bg-warm-gray">
          {busy ? "Saving…" : "Accept"}
        </button>
        <button type="button" disabled={busy} onClick={() => void decline()} className="rounded-pill bg-paper px-3 py-1.5 text-[14px] font-semibold text-ink shadow-hairline hover:shadow-card disabled:text-warm-gray">
          Decline
        </button>
      </div>
      {state.phase === "error" && (
        <p role="alert" className="mt-2 text-[13px] leading-[1.5] text-ink">
          {state.message}
        </p>
      )}
    </li>
  );
}

/** Fabric offered through /submit, waiting for the workshop's decision. */
export function SubmissionsPanel({pin, onChanged, onLocked}: {pin: string; onChanged: () => void; onLocked: () => void}) {
  const [cards, setCards] = useState<SubmissionCard[] | null>(null);
  const [failed, setFailed] = useState(false);

  const [reload, setReload] = useState(0);
  const lockRef = useRef(onLocked);
  useEffect(() => {
    lockRef.current = onLocked;
  });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/workshop/submissions", {headers: {"x-workshop-pin": pin}, cache: "no-store"})
      .then(async (response) => {
        if (cancelled) return;
        if (response.status === 401) return lockRef.current();
        if (!response.ok) return setFailed(true);
        setCards(((await response.json()) as {submissions: SubmissionCard[]}).submissions);
        setFailed(false);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [pin, reload]);

  return (
    <section aria-labelledby="col-offers" className="mt-8 rounded-feature bg-recessed p-3">
      <h2 id="col-offers" className="flex items-baseline justify-between px-1 font-serif text-[20px] font-medium leading-[1.3] text-ink">
        Offered fabric
        <span className="font-mono text-[13px] font-normal text-muted">{cards?.length ?? "…"}</span>
      </h2>
      {failed && (
        <p role="alert" className="mt-3 px-1 text-[14px] text-ink">
          Couldn&apos;t load the offers. <button type="button" onClick={() => setReload((count) => count + 1)} className="underline underline-offset-[6px]">Try again</button>
        </p>
      )}
      {cards && cards.length === 0 && <p className="mt-3 px-1 text-[14px] leading-[1.71] text-muted">No new offers. People can send fabric from the Offer your fabric page.</p>}
      {cards && cards.length > 0 && (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <SubmissionItem key={card.id} card={card} pin={pin} onChanged={onChanged} onLocked={onLocked} />
          ))}
        </ul>
      )}
    </section>
  );
}
