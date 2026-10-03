import Link from "next/link";

import {ORDER_STEPS, type OrderStatus} from "../lib/order-status";
import {formatPrice} from "../lib/shop";
import {CutPlan} from "./cut-plan";

const MESSAGES: Record<OrderStatus["step"], string> = {
  Reserved: "Your cut is reserved. The workshop will contact you at the email you gave to arrange payment and shipping. You pay nothing now.",
  Cut: "Your pieces are cut.",
  Sewn: "Your order is sewn and nearly on its way.",
  Shipped: "Your order has shipped. The workshop will send delivery details to your email.",
};

export function OrderStatusView({order}: {order: OrderStatus}) {
  const current = ORDER_STEPS.indexOf(order.step);
  return (
    <main className="mx-auto max-w-page px-6 pb-4 pt-10">
      <Link href="/shop" className="text-[14px] text-ink underline-offset-[6px] hover:underline">
        ← Back to the shop
      </Link>

      <div className="mt-6 grid gap-10 lg:grid-cols-[1.15fr_1fr] lg:gap-14">
        <div className="self-start">
          <div className="rounded-feature bg-paper p-5 shadow-card">
            <CutPlan
              widthCm={order.widthCm}
              heightCm={order.heightCm}
              photoUrl={order.photoUrl}
              ariaLabel={`${order.title}, ${order.widthCm} by ${order.heightCm} centimetres. The darkened areas are your panels.`}
              allocations={order.pieces}
              stampLabel="Yours"
              className="border border-charcoal/60"
            />
          </div>
          <p className="mt-3 font-mono text-[12px] leading-[1.5] text-muted">The darkened areas are the panels cut for you.</p>
        </div>

        <div>
          <h1 className="text-[clamp(32px,5vw,44px)] leading-[1.25] text-ink">Your order</h1>
          <p className="mt-2 break-all font-mono text-[14px] leading-[1.71] text-muted">Order number: {order.id.replace(/^orders\./, "")}</p>
          <p className="mt-6 font-serif text-[20px] font-medium leading-[1.3] text-ink">
            {order.productName} from {order.title}
          </p>
          <p className="mt-1 font-mono text-[14px] leading-[1.71] text-ink">
            {order.price !== null ? formatPrice(order.price) : null}
            {order.price !== null && order.orderedOn ? " · " : ""}
            {order.orderedOn ? <span className="text-muted">Ordered {order.orderedOn}</span> : null}
          </p>

          <ol aria-label="Order progress" className="mt-8 space-y-4">
            {ORDER_STEPS.map((step, index) => {
              const done = index < current;
              const active = index === current;
              return (
                <li key={step} aria-current={active ? "step" : undefined} className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className={`flex size-7 shrink-0 items-center justify-center rounded-pill font-mono text-[12px] ${
                      done || active ? "bg-teal text-paper" : "bg-recessed text-muted"
                    }`}
                  >
                    {done ? "✓" : index + 1}
                  </span>
                  <span className={`text-[16px] leading-[1.63] ${active ? "font-semibold text-ink" : done ? "text-ink" : "text-muted"}`}>
                    {step}
                    {done ? <span className="sr-only"> (done)</span> : null}
                  </span>
                </li>
              );
            })}
          </ol>

          <p role="status" className="mt-8 rounded-feature bg-paper p-5 text-[16px] leading-[1.63] text-ink shadow-card">
            {MESSAGES[order.step]}
          </p>
        </div>
      </div>
    </main>
  );
}
