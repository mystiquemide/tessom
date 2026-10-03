"use client";

import {createClient} from "@sanity/client";
import {useRouter} from "next/navigation";
import {useEffect} from "react";

/**
 * Watches one remnant in Sanity and refreshes the page when it changes, so an order placed in another
 * window makes the sold area and its competing cuts disappear here without a reload. The dataset is public.
 */
export function LiveRefresh({remnantId}: {remnantId: string}) {
  const router = useRouter();

  useEffect(() => {
    const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
    if (!projectId) return;
    const client = createClient({
      projectId,
      dataset: process.env.NEXT_PUBLIC_SANITY_DATASET || "production",
      apiVersion: "2026-10-01",
      useCdn: false,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const subscription = client
      .listen('*[_type == "remnant" && _id == $id]', {id: remnantId}, {includeResult: false, visibility: "query"})
      .subscribe({
        next: (event) => {
          if (event.type !== "mutation") return;
          clearTimeout(timer);
          timer = setTimeout(() => router.refresh(), 250);
        },
        error: () => undefined,
      });
    return () => {
      clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, [remnantId, router]);

  return null;
}
