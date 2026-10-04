import type {Metadata} from "next";

export const metadata: Metadata = {
  title: "Privacy | Tessom",
  description: "What Tessom collects when you order, why, and who can see it.",
};

const SECTIONS = [
  {
    heading: "What we collect",
    body: "When you order a cut, we keep your name, your email address and which cut you ordered. Browsing the shop collects nothing about you.",
  },
  {
    heading: "Why",
    body: "So the workshop can contact you to arrange payment and shipping. We use your details for nothing else, and we don't sell or share them.",
  },
  {
    heading: "How it is stored",
    body: "Your name and email are encrypted before they are saved. The data is held in Sanity, our content host, and only the encrypted form is stored there.",
  },
  {
    heading: "Who can see it",
    body: "The workshop can open your name and email on its private board, to contact you. Owners of the fabric see what their offcuts have earned, never who bought. Your order page shows your order and its progress, never your name or email.",
  },
  {
    heading: "Cookies and tracking",
    body: "This site sets no cookies and runs no analytics or advertising trackers.",
  },
  {
    heading: "Payments",
    body: "No payment is taken on this site. Ordering reserves your cut. The workshop arranges payment with you directly.",
  },
  {
    heading: "Fabric photo extraction",
    body: "When a workshop editor explicitly uses Read selvage photo in Studio, the selected Sanity image is sent to Groq to read visible manufacturer details. No buyer name or email is included. The result is shown for review before anything is saved.",
  },
  {
    heading: "If you offer your fabric",
    body: "The offer form keeps your name, your email, the fabric's size and notes, and the photo you upload. Your name and email are encrypted before they are saved, and the offer stays on a private path that the public data does not return. Only the workshop can read it, to contact you. Nothing is listed until you approve it.",
  },
  {
    heading: "Questions about your details",
    body: "Ask the workshop that contacts you about your order. It holds the only readable copy.",
  },
] as const;

export default function PrivacyPage() {
  return (
    <main id="main" className="mx-auto max-w-page px-6 pb-20 pt-16 sm:pt-20">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-[clamp(32px,5vw,44px)] leading-[1.25] text-ink">Privacy</h1>
        <p className="mt-3 text-[16px] leading-[1.63] text-body">What Tessom collects when you order, why, and who can see it.</p>
        <div className="mt-10 space-y-8">
          {SECTIONS.map((section) => (
            <section key={section.heading}>
              <h2 className="text-[28px] leading-[1.31] text-ink">{section.heading}</h2>
              <p className="mt-2 text-[16px] leading-[1.63] text-body">{section.body}</p>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
