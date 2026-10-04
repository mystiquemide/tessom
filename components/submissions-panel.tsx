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

  async function accept() {
    const valuePerM = Number(value);
    if (!Number.isFinite(valuePerM) || valuePerM <= 0) {
      setState({phase: "error", message: "Enter what this fabric is worth per metre."});
      return;
    }
    const response = await send("/api/workshop/submissions/accept", {submissionId: card.id, valuePerM});
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
        <h3 className="font-serif text-[16px] font-medium text-ink">{card.title} is in Awaiting consent.</h3>
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
