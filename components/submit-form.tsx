"use client";

import {useState, type FormEvent} from "react";

type Phase = {name: "form"} | {name: "pending"} | {name: "done"; reference: string} | {name: "error"; message: string};

const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const inputClass =
  "mt-1 w-full rounded-card border border-charcoal bg-paper px-4 py-3 text-[16px] leading-[1.63] text-ink placeholder:text-muted";
const labelClass = "mt-5 block text-[14px] font-semibold text-ink";

export function SubmitForm() {
  const [phase, setPhase] = useState<Phase>({name: "form"});

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const photo = (form.elements.namedItem("photo") as HTMLInputElement).files?.[0];
    if (!photo) return setPhase({name: "error", message: "Add a photo of the fabric."});
    if (photo.size > MAX_PHOTO_BYTES) return setPhase({name: "error", message: "That photo is over 3 MB. Use a smaller one."});
    setPhase({name: "pending"});
    try {
      const response = await fetch("/api/submissions", {method: "POST", body: new FormData(form)});
      const body = (await response.json().catch(() => ({}))) as {reference?: string; error?: string};
      if (response.status === 201 && body.reference) return setPhase({name: "done", reference: body.reference});
      setPhase({name: "error", message: response.status === 429 ? "You've sent a few already. Try again later." : (body.error ?? "Something went wrong. Try again.")});
    } catch {
      setPhase({name: "error", message: "You seem to be offline. Try again."});
    }
  }

  if (phase.name === "done") {
    return (
      <div role="status" className="rounded-feature bg-paper p-6 shadow-lift">
        <h2 className="text-[28px] leading-[1.31] text-ink">Thanks, we have your fabric.</h2>
        <p className="mt-2 text-[16px] leading-[1.63] text-body">
          The workshop reviews every submission before anything is listed, and will email you at the address you gave. Nothing is public yet.
        </p>
        <p className="mt-3 font-mono text-[14px] text-ink">Reference {phase.reference}</p>
      </div>
    );
  }

  const busy = phase.name === "pending";
  return (
    <form onSubmit={onSubmit} className="rounded-feature bg-paper p-6 shadow-lift">
      <label className={labelClass}>
        Your name
        <input className={inputClass} name="name" autoComplete="name" maxLength={160} required />
      </label>
      <label className={labelClass}>
        Email
        <input className={inputClass} name="email" type="email" autoComplete="email" maxLength={320} required />
      </label>
      <label className={labelClass}>
        You are
        <select className={inputClass} name="kind" defaultValue="client" required>
          <option value="client">The client who owns the fabric</option>
          <option value="designer">A designer</option>
          <option value="workshop">A workshop</option>
        </select>
      </label>
      <div className="grid grid-cols-2 gap-4">
        <label className={labelClass}>
          Width (cm)
          <input className={inputClass} name="widthCm" type="number" inputMode="decimal" min={20} max={600} step="any" required />
        </label>
        <label className={labelClass}>
          Height (cm)
          <input className={inputClass} name="heightCm" type="number" inputMode="decimal" min={20} max={600} step="any" required />
        </label>
      </div>
      <label className={labelClass}>
        Fabric name <span className="font-normal text-body">(optional, from the selvage)</span>
        <input className={inputClass} name="fabricName" maxLength={160} />
      </label>
      <label className={labelClass}>
        Maker <span className="font-normal text-body">(optional)</span>
        <input className={inputClass} name="maker" maxLength={160} />
      </label>
      <label className="mt-5 flex items-center gap-3 text-[16px] text-ink">
        <input type="checkbox" name="directional" value="true" className="h-5 w-5" />
        The pattern has a direction (nap or one-way print)
      </label>
      <label className={labelClass}>
        Flaws or notes <span className="font-normal text-body">(optional)</span>
        <textarea className={inputClass} name="notes" rows={3} maxLength={1000} placeholder="A pulled thread near one corner, a water mark..." />
      </label>
      <label className={labelClass}>
        Photo of the fabric
        <input className={inputClass} name="photo" type="file" accept="image/jpeg,image/png,image/webp" required />
        <span className="mt-1 block text-[14px] font-normal leading-[1.71] text-body">JPG, PNG or WebP, up to 3 MB. Include the selvage if you can.</span>
      </label>
      {/* Honeypot: hidden from people, filled by scripts. */}
      <div aria-hidden="true" className="absolute -left-[9999px]">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {phase.name === "error" && (
        <p role="alert" className="mt-4 text-[14px] leading-[1.71] text-ink">
          {phase.message}
        </p>
      )}
      <p className="mt-5 text-[14px] leading-[1.71] text-body">
        Your email is encrypted and only the workshop can read it. Submitting lists nothing and promises nothing.{" "}
        <a href="/privacy" className="text-ink underline underline-offset-[6px]">How we handle your details</a>
      </p>
      <button type="submit" disabled={busy} className="mt-5 inline-flex rounded-full bg-ink px-6 py-3 text-[16px] font-semibold text-paper disabled:opacity-60">
        {busy ? "Sending..." : "Send my fabric"}
      </button>
    </form>
  );
}
