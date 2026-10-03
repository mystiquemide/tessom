"use client";

import Image from "next/image";
import {useCallback, useState} from "react";

import type {BoardCard, BoardColumn} from "../lib/workshop/board";

type LoadResult = "ok" | "unauthorized" | "unconfigured" | "error";

async function loadBoard(pin: string): Promise<{result: LoadResult; columns?: BoardColumn[]}> {
  try {
    const response = await fetch("/api/workshop/board", {headers: {"x-workshop-pin": pin}, cache: "no-store"});
    if (response.ok) return {result: "ok", columns: ((await response.json()) as {columns: BoardColumn[]}).columns};
    if (response.status === 401) return {result: "unauthorized"};
    if (response.status === 503) return {result: "unconfigured"};
    return {result: "error"};
  } catch {
    return {result: "error"};
  }
}

function PinGate({onUnlock, error, busy}: {onUnlock: (pin: string) => void; error: string | null; busy: boolean}) {
  const [value, setValue] = useState("");
  return (
    <main className="mx-auto max-w-page px-6 pb-4 pt-16 sm:pt-24">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim() && !busy) onUnlock(value.trim());
        }}
        className="mx-auto max-w-md rounded-feature bg-paper p-6 shadow-card"
      >
        <h1 className="text-[28px] leading-[1.31] text-ink">Workshop</h1>
        <p className="mt-2 text-[16px] leading-[1.63] text-body">Enter the workshop PIN to open the board.</p>
        <label className="mt-6 block text-[14px] font-semibold text-ink">
          PIN
          <input
            type="password"
            autoComplete="current-password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="mt-1 w-full rounded-card border border-charcoal bg-paper px-4 py-3 text-[16px] leading-[1.63] text-ink"
          />
        </label>
        {error && (
          <p role="alert" className="mt-3 text-[14px] leading-[1.71] text-ink">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={!value.trim() || busy}
          className="mt-6 rounded-pill bg-ink px-5 py-2 text-[16px] font-semibold text-paper disabled:cursor-not-allowed disabled:bg-warm-gray"
        >
          {busy ? <span className="font-mono text-[14px] font-normal">Checking…</span> : "Open the board"}
        </button>
      </form>
    </main>
  );
}

function CopyOwnerLink({path}: {path: string}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const url = typeof window === "undefined" ? path : `${window.location.origin}${path}`;
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setState("copied");
            setTimeout(() => setState("idle"), 2500);
          } catch {
            setState("failed");
          }
        }}
        className="w-full rounded-pill bg-paper px-3 py-1.5 text-[14px] font-semibold text-ink shadow-hairline hover:shadow-card"
      >
        {state === "copied" ? "Link copied" : "Copy owner link"}
      </button>
      {state === "failed" && (
        <input readOnly value={url} onFocus={(event) => event.currentTarget.select()} aria-label="Owner link" className="mt-2 w-full rounded-[4px] border border-charcoal bg-paper px-2 py-1 font-mono text-[12px] text-ink" />
      )}
    </div>
  );
}

function Card({card, busy, error, onAdvance}: {card: BoardCard; busy: boolean; error: string | undefined; onAdvance: (card: BoardCard) => void}) {
  return (
    <li className="rounded-card bg-paper p-3 shadow-card">
      <div className="flex gap-2.5">
        {card.photoUrl && <Image src={card.photoUrl} alt="" width={40} height={40} loading="eager" className="size-10 shrink-0 rounded-[4px] bg-recessed object-cover" />}
        <div className="min-w-0">
          <h3 className="font-serif text-[16px] font-medium leading-[1.3] text-ink">{card.title}</h3>
          <p className="mt-0.5 font-mono text-[12px] leading-[1.5] text-muted">{card.subtitle}</p>
        </div>
      </div>
      {card.details.length > 0 && (
        <p className="mt-2 font-mono text-[12px] leading-[1.5] text-body">{card.details.join(" · ")}</p>
      )}
      {card.ownerLink && <CopyOwnerLink path={card.ownerLink} />}
      {card.action && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onAdvance(card)}
          className="mt-3 w-full rounded-pill bg-ink px-3 py-1.5 text-[14px] font-semibold text-paper disabled:bg-warm-gray"
        >
          {busy ? <span className="font-mono text-[12px] font-normal">Saving…</span> : card.action.label}
        </button>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[12px] leading-[1.5] text-ink">
          {error}
        </p>
      )}
    </li>
  );
}

export function WorkshopBoard() {
  const [pin, setPin] = useState<string | null>(null);
  const [columns, setColumns] = useState<BoardColumn[] | null>(null);
  const [gateError, setGateError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [busyCard, setBusyCard] = useState<string | null>(null);
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});

  const lock = useCallback((message: string | null = null) => {
    setPin(null);
    setColumns(null);
    setGateError(message);
  }, []);

  const applyLoad = useCallback(
    (candidate: string, outcome: {result: LoadResult; columns?: BoardColumn[]}) => {
      if (outcome.result === "ok" && outcome.columns) {
        setPin(candidate);
        setColumns(outcome.columns);
        return;
      }
      lock(
        outcome.result === "unauthorized"
          ? "That PIN didn't work."
          : outcome.result === "unconfigured"
            ? "The workshop board isn't set up on this server."
            : "Couldn't reach the board. Try again in a moment.",
      );
    },
    [lock],
  );

  const unlock = useCallback(
    async (candidate: string) => {
      setChecking(true);
      setGateError(null);
      const outcome = await loadBoard(candidate);
      setChecking(false);
      applyLoad(candidate, outcome);
    },
    [applyLoad],
  );

  async function refresh() {
    if (!pin) return;
    setRefreshing(true);
    setBoardError(null);
    const {result, columns: loaded} = await loadBoard(pin);
    setRefreshing(false);
    if (result === "ok" && loaded) setColumns(loaded);
    else if (result === "unauthorized") lock("The PIN is no longer valid. Enter it again.");
    else setBoardError("Couldn't refresh the board. Try again.");
  }

  async function advance(card: BoardCard) {
    if (!pin || !card.action || !card.workflowInstanceId) return;
    setBusyCard(card.id);
    setCardErrors((current) => ({...current, [card.id]: ""}));
    try {
      const response = await fetch("/api/workflow/advance", {
        method: "POST",
        headers: {"content-type": "application/json", "x-workshop-pin": pin},
        body: JSON.stringify({action: card.action.name, workflowInstanceId: card.workflowInstanceId}),
      });
      if (response.status === 401) {
        lock("The PIN is no longer valid. Enter it again.");
        return;
      }
      if (!response.ok) {
        setCardErrors((current) => ({
          ...current,
          [card.id]: response.status === 409 ? "This order moved already. The board is refreshed." : "Couldn't move this order. Try again.",
        }));
      }
      await refresh();
    } catch {
      setCardErrors((current) => ({...current, [card.id]: "Couldn't reach the workshop. Try again."}));
    } finally {
      setBusyCard(null);
    }
  }

  if (!pin || !columns) return <PinGate onUnlock={(value) => void unlock(value)} error={gateError} busy={checking} />;

  const total = columns.reduce((sum, column) => sum + column.cards.length, 0);

  return (
    <main className="mx-auto max-w-[1440px] px-6 pb-4 pt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[clamp(32px,5vw,44px)] leading-[1.25] text-ink">Workshop board</h1>
          <p className="mt-2 max-w-xl text-[16px] leading-[1.63] text-body">
            Move each order from allocated to shipped. Owners decide consent, so those cards only wait here.
          </p>
        </div>
        <div className="flex items-center gap-4 text-[14px]">
          <span className="font-mono text-muted">{total} cards</span>
          <button type="button" onClick={() => void refresh()} disabled={refreshing} className="text-ink underline-offset-[6px] hover:underline disabled:text-warm-gray">
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          <button type="button" onClick={() => lock()} className="text-ink underline-offset-[6px] hover:underline">
            Lock
          </button>
        </div>
      </div>
      {boardError && (
        <p role="alert" className="mt-4 text-[14px] text-ink">
          {boardError}
        </p>
      )}

      <div className="mt-8 grid auto-cols-[minmax(188px,1fr)] grid-flow-col items-start gap-4 overflow-x-auto pb-4">
        {columns.map((column) => (
          <section key={column.id} aria-labelledby={`col-${column.id}`} className="rounded-feature bg-recessed p-3">
            <h2 id={`col-${column.id}`} className="flex items-baseline justify-between px-1 font-serif text-[20px] font-medium leading-[1.3] text-ink">
              {column.title}
              <span className="font-mono text-[12px] font-normal text-muted">{column.cards.length}</span>
            </h2>
            {column.cards.length > 0 ? (
              <ul className="mt-3 space-y-3">
                {column.cards.map((card) => (
                  <Card key={card.id} card={card} busy={busyCard === card.id} error={cardErrors[card.id] || undefined} onAdvance={(c) => void advance(c)} />
                ))}
              </ul>
            ) : (
              <p className="mt-3 px-1 text-[14px] leading-[1.71] text-muted">{column.empty}</p>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
