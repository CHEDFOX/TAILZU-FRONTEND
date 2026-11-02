import { useEffect } from "react";
import type { BootstrapResponse, LaunchCard } from "../../types";
import { hasSeenCard, markCardSeen } from "../launchCard";
import type { Phase, SetState } from "../types";

/** The launch card the bootstrap carries, shown once per card id (or every launch, when it says so). */
export function useLaunchCard({
  phase, boot, setLaunchCard,
}: {
  phase: Phase;
  boot: BootstrapResponse | null;
  setLaunchCard: SetState<LaunchCard | null>;
}) {
  // Decide about the launch card once the bootstrap has landed.
  //
  // Asked once per card id, not once per render: `repeat: "everyLaunch"` means
  // every cold open, and this component mounts once per open, so the effect
  // firing is the launch. A card is marked seen when it is PUT UP rather than
  // when it is dismissed — a card that crashes or is killed mid-read has still
  // been shown, and showing it again forever is worse than missing it once.
  useEffect(() => {
    const card = boot?.launchCard;
    if (phase !== "ready" || !card?.id || !card.root) { setLaunchCard(null); return; }
    let alive = true;
    void (async () => {
      if (card.repeat !== "everyLaunch" && (await hasSeenCard(card.id))) return;
      if (!alive) return;
      setLaunchCard(card);
      void markCardSeen(card.id);
    })();
    return () => { alive = false; };
  }, [phase, boot?.launchCard]);
}
