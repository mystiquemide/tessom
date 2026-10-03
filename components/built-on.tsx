import Image from "next/image";

const PARTNERS = [
  {
    name: "Sanity",
    logo: "/logos/sanity.svg",
    text: "Every offcut, owner and order lives in Sanity. Sanity Workflows carry each piece from consent to shipped.",
    href: "https://www.sanity.io",
  },
] as const;

export function BuiltOn() {
  return (
    <section aria-labelledby="built-on" className="mx-auto max-w-page px-6 pt-20">
      <div className="border-t border-rule pt-12">
        <p id="built-on" className="text-center font-mono text-[14px] uppercase tracking-wide text-muted">
          Built on
        </p>
        <ul className="mx-auto mt-8 max-w-xl">
          {PARTNERS.map((partner) => (
            <li key={partner.name} className="text-center">
              <a href={partner.href} rel="noopener noreferrer" className="inline-flex items-center gap-3 text-ink">
                <Image src={partner.logo} alt="" width={28} height={28} unoptimized />
                <span className="font-serif text-[20px] font-medium leading-[1.3]">{partner.name}</span>
              </a>
              <p className="mt-2 text-[14px] leading-[1.71] text-body">{partner.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
