import type {ShopStats} from "../lib/shop";

export function Stats({stats}: {stats: ShopStats}) {
  const items = [
    {count: stats.pieces, value: String(stats.pieces), label: stats.pieces === 1 ? "offcut on the table" : "offcuts on the table"},
    {count: stats.offers, value: String(stats.offers), label: stats.offers === 1 ? "way to cut them" : "ways to cut them"},
    {count: stats.areaM2, value: `${stats.areaM2} m²`, label: "of premium fabric waiting"},
  ].filter((item) => item.count > 0);

  if (items.length === 0) return null;

  return (
    <section aria-label="On the table right now" className="mx-auto max-w-page px-6 pt-10">
      <dl className="grid gap-8 border-y border-rule py-10 text-center sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-rule">
        {items.map((item) => (
          <div key={item.label} className="px-6">
            <dd className="font-serif text-[36px] leading-[1.31] text-ink">{item.value}</dd>
            <dt className="mt-1 text-[14px] leading-[1.71] text-body">{item.label}</dt>
          </div>
        ))}
      </dl>
    </section>
  );
}
