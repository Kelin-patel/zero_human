"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const EVERY_SECONDS = 15;

/** Re-fetches the ledger from the server every 15 seconds and shows how long ago that was. */
export function LiveRefresh() {
  const router = useRouter();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed((s) => {
        if (s + 1 >= EVERY_SECONDS) {
          router.refresh();
          return 0;
        }
        return s + 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [router]);

  return (
    <span className="text-sm text-ink-3" aria-live="off">
      Live · refreshed {elapsed}s ago
    </span>
  );
}
