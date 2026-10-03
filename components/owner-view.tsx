"use client";

import Image from "next/image";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {useState} from "react";

import type {Owner, OwnerRemnant} from "../lib/owners";
import {formatPrice} from "../lib/shop";

type Decision = "grant" | "decline";

function StagePill({remnant, canDecide}: {remnant: OwnerRemnant; canDecide: boolean}) {
  const tone = remnant.awaitingConsent ? "text-rust" : remnant.stageLabel === "Listed" ? "text-teal" : "text-ink";
  const label = remnant.awaitingConsent ? (canDecide ? "Waiting for your decision" : "Waiting for the owner") : remnant.stageLabel;
  return <span className={`inline-flex rounded-pill bg-paper px-3 py-1 font-mono text-[14px] leading-[1.71] shadow-hairline ${tone}`}>{label}</span>;
}

export function OwnerView({owner, decisionKey}: {owner: Owner; decisionKey: string | null}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const waiting = owner.remnants.filter((remnant) => remnant.awaitingConsent);

  async function decide(remnant: OwnerRemnant, decision: Decision) {
    if (!decisionKey) return;
    setSaving(remnant.id);
    setConfirming(null);
    try {
      const response = await fetch("/api/owner/consent", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({ownerId: owner.id, remnantId: remnant.id, decision, key: decisionKey}),
      });
      if (response.ok) {
        setNotes((current) => ({...current, [remnant.id]: decision === "grant" ? "Approved. This offcut is now listed." : "Declined. This offcut goes back to the workshop."}));
        router.refresh();
      } else if (response.status === 409) {
        setNotes((current) => ({...current, [remnant.id]: "This offcut was already decided."}));
        router.refresh();
      } else if (response.status === 401) {
        setNotes((current) => ({...current, [remnant.id]: "This link is no longer valid. Ask the workshop for a new one."}));
      } else {
        setNotes((current) => ({...current, [remnant.id]: "Couldn't save your decision. Try again."}));
      }
    } catch {
      setNotes((current) => ({...current, [remnant.id]: "Couldn't reach the workshop. Try again."}));
    } finally {
      setSaving(null);
    }
  }

  return (
    <main id="main" className="mx-auto max-w-page px-6 pb-4 pt-10">
      <Link href="/owner" className="inline-flex min-h-11 items-center text-[14px] text-ink underline-offset-[6px] hover:underline">
        ← All owners
      </Link>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="text-[clamp(32px,5vw,44px)] leading-[1.25] text-ink">{owner.name}</h1>
          <p className="mt-2 font-mono text-[14px] leading-[1.71] text-muted">
            {owner.kindLabel}
            {owner.sharePercent !== null ? ` · ${owner.sharePercent}% of the fabric's value` : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[13px] uppercase tracking-wide text-muted">Earned so far</p>
          <p className="font-serif text-[36px] leading-[1.31] text-rust">{formatPrice(owner.earned)}</p>
        </div>
      </div>
      <p className="mt-2 text-[14px] leading-[1.71] text-body">Accrued from orders on this owner&apos;s offcuts. This site tracks what is owed. It does not make payments.</p>

      {decisionKey && waiting.length > 0 && (
        <p className="mt-6 rounded-feature bg-paper p-5 text-[16px] leading-[1.63] text-ink shadow-card">
          {waiting.length === 1 ? "One offcut is" : `${waiting.length} offcuts are`} waiting for your decision. Nothing is listed until you say yes.
        </p>
      )}

      {owner.remnants.length > 0 ? (
        <ul className="mt-8 space-y-4">
          {owner.remnants.map((remnant) => (
            <li key={remnant.id} className="flex flex-col gap-4 rounded-feature bg-paper p-5 shadow-card sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-4">
                {remnant.photoUrl && <Image src={remnant.photoUrl} alt="" width={72} height={72} loading="eager" className="size-[72px] shrink-0 rounded-card bg-recessed object-cover" />}
                <div className="min-w-0">
                  <h2 className="font-serif text-[20px] font-medium leading-[1.3] text-ink">{remnant.title}</h2>
                  <p className="mt-0.5 font-mono text-[14px] leading-[1.71] text-muted">
                    {remnant.widthCm} × {remnant.heightCm} cm
                    {remnant.earned > 0 ? <span className="text-rust"> · earned {formatPrice(remnant.earned)}</span> : null}
                  </p>
                </div>
              </div>

              <div className="flex flex-col items-start gap-3 sm:items-end">
                <StagePill remnant={remnant} canDecide={decisionKey !== null} />
                {remnant.awaitingConsent && decisionKey && confirming !== remnant.id && (
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      disabled={saving === remnant.id}
                      onClick={() => void decide(remnant, "grant")}
                      className="rounded-pill bg-ink px-4 py-2 text-[14px] font-semibold text-paper disabled:bg-warm-gray"
                    >
                      {saving === remnant.id ? <span className="font-mono text-[13px] font-normal">Saving…</span> : "Approve and list"}
                    </button>
                    <button
                      type="button"
                      disabled={saving === remnant.id}
                      onClick={() => setConfirming(remnant.id)}
                      className="min-h-11 px-2 py-2 text-[14px] text-ink underline-offset-[6px] hover:underline disabled:text-warm-gray"
                    >
                      Decline
                    </button>
                  </div>
                )}
                {remnant.awaitingConsent && decisionKey && confirming === remnant.id && (
                  <div role="group" aria-label={`Confirm declining ${remnant.title}`} className="max-w-xs text-[14px] leading-[1.71] text-ink sm:text-right">
                    <p>Decline this offcut? It goes back to the workshop and is not listed.</p>
                    <div className="mt-2 flex items-center gap-3 sm:justify-end">
                      <button type="button" onClick={() => void decide(remnant, "decline")} className="rounded-pill bg-ink px-4 py-2 text-[14px] font-semibold text-paper">
                        Yes, decline
                      </button>
                      <button type="button" onClick={() => setConfirming(null)} className="min-h-11 px-2 py-2 underline-offset-[6px] hover:underline">
                        Keep waiting
                      </button>
                    </div>
                  </div>
                )}
                {remnant.awaitingConsent && !decisionKey && (
                  <p className="max-w-xs text-[14px] leading-[1.71] text-body sm:text-right">The owner decides. The workshop sends them a private link.</p>
                )}
                {notes[remnant.id] && (
                  <p role="status" className="max-w-xs text-[14px] leading-[1.71] text-ink sm:text-right">
                    {notes[remnant.id]}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-8 rounded-feature bg-paper p-5 text-[16px] leading-[1.63] text-body shadow-card">No offcuts from this owner yet.</p>
      )}
    </main>
  );
}
