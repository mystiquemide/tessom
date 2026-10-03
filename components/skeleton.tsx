/** Placeholder shapes shown while a page loads. They carry no data. */
function Bar({className = ""}: {className?: string}) {
  return <div aria-hidden="true" className={`animate-pulse rounded-card bg-rule ${className}`} />;
}

function Frame({label, children}: {label: string; children: React.ReactNode}) {
  return (
    <div role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

function CardShape() {
  return (
    <div aria-hidden="true" className="rounded-feature bg-paper p-5 shadow-card">
      <Bar className="aspect-[16/10] w-full" />
      <Bar className="mt-4 h-5 w-2/3" />
      <Bar className="mt-2 h-4 w-1/2" />
    </div>
  );
}

export function ShopSkeleton() {
  return (
    <Frame label="Loading the shop">
      <div className="mx-auto max-w-page px-6 pt-16 sm:pt-20">
        <Bar className="mx-auto h-10 w-72 max-w-full" />
        <Bar className="mx-auto mt-4 h-4 w-96 max-w-full" />
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {Array.from({length: 6}, (_, index) => (
            <Bar key={index} className="h-9 w-24 rounded-pill" />
          ))}
        </div>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({length: 6}, (_, index) => (
            <CardShape key={index} />
          ))}
        </div>
      </div>
    </Frame>
  );
}

export function RemnantSkeleton() {
  return (
    <Frame label="Loading this piece">
      <div className="mx-auto max-w-page px-6 pt-10">
        <Bar className="h-4 w-24" />
        <div className="mt-6 grid gap-10 lg:grid-cols-[1.15fr_1fr] lg:gap-14">
          <div aria-hidden="true" className="rounded-feature bg-paper p-5 shadow-card">
            <Bar className="aspect-[14/9] w-full" />
          </div>
          <div aria-hidden="true">
            <Bar className="h-11 w-3/4" />
            <Bar className="mt-3 h-4 w-1/2" />
            <div className="mt-8 space-y-3">
              {Array.from({length: 3}, (_, index) => (
                <Bar key={index} className="h-24 w-full rounded-feature" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </Frame>
  );
}

export function OwnersSkeleton() {
  return (
    <Frame label="Loading owners">
      <div className="mx-auto max-w-page px-6 pt-16 sm:pt-20">
        <Bar className="mx-auto h-10 w-80 max-w-full" />
        <Bar className="mx-auto mt-4 h-4 w-[28rem] max-w-full" />
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({length: 6}, (_, index) => (
            <div key={index} aria-hidden="true" className="rounded-feature bg-paper p-5 shadow-card">
              <Bar className="h-5 w-2/3" />
              <Bar className="mt-2 h-4 w-1/4" />
              <Bar className="mt-6 h-4 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    </Frame>
  );
}

export function OwnerSkeleton() {
  return (
    <Frame label="Loading this owner">
      <div className="mx-auto max-w-page px-6 pt-10">
        <Bar className="h-4 w-24" />
        <Bar className="mt-8 h-11 w-72 max-w-full" />
        <Bar className="mt-3 h-4 w-56" />
        <div className="mt-8 space-y-4">
          {Array.from({length: 3}, (_, index) => (
            <Bar key={index} className="h-28 w-full rounded-feature" />
          ))}
        </div>
      </div>
    </Frame>
  );
}

export function PageSkeleton() {
  return (
    <Frame label="Loading">
      <div className="mx-auto max-w-page px-6 pt-24">
        <Bar className="mx-auto h-12 w-[34rem] max-w-full" />
        <Bar className="mx-auto mt-5 h-4 w-96 max-w-full" />
        <Bar className="mx-auto mt-8 h-10 w-40 rounded-pill" />
      </div>
    </Frame>
  );
}
