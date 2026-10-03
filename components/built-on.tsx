import Image from "next/image";

const PARTNERS = [
  {
    name: "Sanity",
    logo: "/logos/sanity.svg",
    text: "Every offcut, owner and order lives in Sanity. Sanity Workflows carry each piece from consent to shipped.",
    href: "https://www.sanity.io",
  },
  {
    name: "Next.js",
    logo: "/logos/nextdotjs.svg",
    text: "The storefront and the order desk run on Next.js, with offers priced on the server.",
    href: "https://nextjs.org",
  },
  {
    name: "Unsplash",
    logo: "/logos/unsplash.svg",
    text: "The fabric and product photography comes from photographers on Unsplash, credited below.",
    href: "https://unsplash.com",
  },
] as const;

export function BuiltOn() {
  return (
    <section aria-labelledby="built-on" className="mx-auto max-w-page px-6 pt-20">
      <div className="border-t border-rule pt-12">
        <p id="built-on" className="text-center font-mono text-[14px] uppercase tracking-wide text-muted">
          Built on
        </p>
        <ul className="mt-8 grid gap-10 md:grid-cols-3 md:gap-8">
          {PARTNERS.map((partner) => (
            <li key={partner.name} className="text-center md:text-left">
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
