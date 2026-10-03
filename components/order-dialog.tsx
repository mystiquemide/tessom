"use client";

import {useEffect, useRef, useState} from "react";

import type {Placement} from "../lib/offers";
import {describeOfferPieces, formatPrice, type ShopOffer, type ShopRemnant} from "../lib/shop";

export interface PlacedOrder {
  orderId: string;
  placement: Placement[];
}

type Phase =
  | {name: "form"}
  | {name: "pending"}
  | {name: "success"; orderId: string}
  | {name: "conflict"}
  | {name: "error"; message: string};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inputClass =
  "mt-1 w-full rounded-card border border-charcoal bg-paper px-4 py-3 text-[16px] leading-[1.63] text-ink placeholder:text-muted";

export function OrderDialog({
  remnant,
  offer,
  onClose,
  onPlaced,
}: {
  remnant: ShopRemnant;
  offer: ShopOffer;
  onClose: (changed: boolean) => void;
  onPlaced: (order: PlacedOrder) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const keyRef = useRef<string>("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>({name: "form"});
  const changed = useRef(false);

  useEffect(() => {
    keyRef.current = crypto.randomUUID();
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const valid = name.trim().length > 0 && EMAIL.test(email.trim());

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid || phase.name === "pending") return;
    setPhase({name: "pending"});
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({
          remnantId: remnant.id,
          templateId: offer.id,
          buyerName: name.trim(),
          buyerEmail: email.trim(),
          offerFingerprint: offer.fingerprint,
          idempotencyKey: keyRef.current,
        }),
      });
      if (response.ok) {
        const order = (await response.json()) as {orderId: string; placement: Placement[]};
        changed.current = true;
        onPlaced({orderId: order.orderId, placement: order.placement});
        setPhase({name: "success", orderId: order.orderId});
        return;
      }
      if (response.status === 409) {
        changed.current = true;
        setPhase({name: "conflict"});
        return;
      }
      setPhase({
        name: "error",
        message:
          response.status === 400
            ? "Check your name and email, then try again."
            : "We couldn't confirm your order. Try again and we won't place it twice.",
      });
    } catch {
      setPhase({name: "error", message: "We couldn't reach the workshop. Try again and we won't place it twice."});
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="order-title"
      onClose={() => onClose(changed.current)}
      onClick={(event) => {
        if (event.target === dialogRef.current && phase.name !== "pending") dialogRef.current?.close();
      }}
      className="m-auto w-[calc(100%-32px)] max-w-md rounded-feature bg-paper p-0 text-ink shadow-lift backdrop:bg-black/30"
    >
      <div className="p-6">
        {(phase.name === "form" || phase.name === "pending" || phase.name === "error") && (
          <form onSubmit={submit} noValidate>
            <h2 id="order-title" className="text-[28px] leading-[1.31] text-ink">
              Order this cut
            </h2>
            <p className="mt-2 text-[16px] leading-[1.63] text-body">
              {offer.name} from {remnant.title}. {describeOfferPieces(offer, ", ")}.
            </p>
            <p className="mt-3 font-mono text-[14px] text-ink">
              {formatPrice(offer.price)} <span className="text-rust">· Owner earns {formatPrice(offer.ownerShare)}</span>
            </p>

            <label className="mt-6 block text-[14px] font-semibold text-ink">
              Your name
              <input className={inputClass} name="name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={160} required />
            </label>
            <label className="mt-4 block text-[14px] font-semibold text-ink">
              Email
              <input className={inputClass} name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={320} required />
            </label>

            {phase.name === "error" && (
              <p role="alert" className="mt-4 text-[14px] leading-[1.71] text-ink">
                {phase.message}
              </p>
            )}

            <p className="mt-4 text-[14px] leading-[1.71] text-body">This reserves the cut. The workshop emails you to arrange payment and shipping.</p>

            <div className="mt-6 flex items-center gap-3">
              <button
                type="submit"
                disabled={!valid || phase.name === "pending"}
                className="rounded-pill bg-ink px-5 py-2 text-[16px] font-semibold text-paper disabled:cursor-not-allowed disabled:bg-warm-gray"
              >
                {phase.name === "pending" ? <span className="font-mono text-[14px] font-normal">Locking the cut…</span> : phase.name === "error" ? "Try again" : "Place order"}
              </button>
              <button
                type="button"
                disabled={phase.name === "pending"}
                onClick={() => dialogRef.current?.close()}
                className="px-3 py-2 text-[16px] text-ink underline-offset-[6px] hover:underline disabled:text-warm-gray"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {phase.name === "success" && (
          <div role="status">
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-paper px-3 py-1 font-mono text-[14px] text-teal shadow-hairline">
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                <circle cx="8" cy="8" r="8" fill="#10756a" />
                <path d="M4.5 8.3l2.2 2.2 4.8-4.9" fill="none" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Allocated
            </span>
            <h2 id="order-title" className="mt-4 text-[28px] leading-[1.31] text-ink">
              Your cut is locked.
            </h2>
            <p className="mt-2 text-[16px] leading-[1.63] text-body">
              {offer.name} from {remnant.title} is yours. The workshop will email {email.trim()} to arrange payment and shipping.
            </p>
            <p className="mt-3 font-mono text-[14px] text-muted">Order {phase.orderId}</p>
            <div className="mt-6 flex items-center gap-4">
              <button type="button" onClick={() => dialogRef.current?.close()} className="rounded-pill bg-ink px-5 py-2 text-[16px] font-semibold text-paper">
                Done
              </button>
              <a href={`/order/${encodeURIComponent(phase.orderId)}`} className="text-[16px] text-ink underline-offset-[6px] hover:underline">
                Track this order
              </a>
            </div>
          </div>
        )}

        {phase.name === "conflict" && (
          <div role="alert">
            <h2 id="order-title" className="text-[28px] leading-[1.31] text-ink">
              Someone just took that part of the piece.
            </h2>
            <p className="mt-2 text-[16px] leading-[1.63] text-body">Here&apos;s what&apos;s still available.</p>
            <button type="button" onClick={() => dialogRef.current?.close()} className="mt-6 rounded-pill bg-ink px-5 py-2 text-[16px] font-semibold text-paper">
              See what&apos;s left
            </button>
          </div>
        )}
      </div>
    </dialog>
  );
}
