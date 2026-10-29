/**
 * A plan's price as the store words it, for a Text node's `storePrice` (storePriceCore.ts says what and why).
 */
import { useEffect, useState } from "react";
import { packagePrices } from "./purchases";
import { fillStorePrice, isStorePriceSpec, type StorePrices } from "./storePriceCore";

// One fetch per offering for the whole app; one that found nothing is asked again by the next screen.
const loads = new Map<string, Promise<StorePrices | null>>();
function load(offeringId?: string): Promise<StorePrices | null> {
  const key = offeringId ?? "";
  let p = loads.get(key);
  if (!p) {
    p = packagePrices(offeringId).then((prices) => { if (!prices) loads.delete(key); return prices; });
    loads.set(key, p);
  }
  return p;
}

/** The store's words for this spec, or null while they are unknown (and for good where the store cannot say). */
export function useStorePrice(spec: unknown): string | null {
  const ok = isStorePriceSpec(spec);
  const key = ok ? JSON.stringify(spec) : "";
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    setShown(null);
    if (!isStorePriceSpec(spec)) return;
    let live = true;
    void load(spec.offeringId).then((prices) => { if (live) setShown(fillStorePrice(spec, prices)); });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return shown;
}
