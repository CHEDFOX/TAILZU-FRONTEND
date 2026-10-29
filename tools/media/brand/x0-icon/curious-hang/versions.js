/* X0 Bot: the hand-drawn Curious, hanging upside down. It reuses ../handdrawn-v2 (draw.js, bot.js,
 * versions.js): each version is drawn the right way up, gripping a ledge, then turned 180 degrees, so
 * the ledge becomes a bar along the top that the bot hangs from by its hands, head down, peeking at you. */
(function () {
  "use strict";
  const { PAL, vgrad } = HD;
  const cur = HD.VERSIONS.find((v) => v.id === "3-curious");
  // no antenna; the eyes on you (drawn upright, a touch up, so once turned they look a touch down, at you)
  const bot = (o = {}) => ({ ...cur.bot, antenna: false, ...o, face: { ...cur.bot.face, look: [0, -10], ...(o.face || {}) } });
  const white = (K) => K.art.paper({ color: "#FCFBF8", mottle: 0.012, grain: 0.03, vignette: 0.02 });
  const bar = { y: 790, slope: -0.006, line: { color: PAL.ink, w: 13, amp: 0.8 }, belowTint: "#ECE9E3" };
  const V = [];

  V.push({ id: "1-white", name: "1 · On white", seed: 1101, ground: white, edge: bar, bot: bot(), style: (K) => HD.brush(K),
    note: "The Curious bot hangs by its hands from a bar along the top, head down, eyes on you. White ground, no antenna." });

  V.push({ id: "2-paper", name: "2 · Its own paper", seed: 1101, ground: cur.ground, edge: { ...cur.edge, belowTint: "#E9DDCB" }, bot: bot(), style: (K) => HD.brush(K),
    note: "The same on the Curious's cream paper and clay brush ring." });

  V.push({ id: "3-black", name: "3 · Black head", seed: 1101, ground: white, edge: bar, bot: bot(),
    style: (K) => HD.brush(K, {
      shell: { color: vgrad("#34302C", "#161412", K.headCY - K.hh, K.headCY + K.hh * 0.5), p: 1 },
      shade: { color: "#000000", p: 1, opacity: 0.35, crescent: [-58, -66, 5] },
      shellShine: { color: "#FFFFFF", w: 20, opacity: 0.35, taper: [20, 26], amp: 0.6 },
      visor: { color: vgrad("#0A0908", "#000000", K.headCY - K.hh * 0.6, K.headCY + K.hh * 0.4), p: 1 },
      visorLine: { color: "#3E3934", w: 6, amp: 0.4 },
    }),
    note: "The current black head, hand-drawn, on white." });

  V.push({ id: "4-cocked", name: "4 · Cocked the other way", seed: 1107, ground: white, edge: bar, bot: bot({ tilt: -0.19 }), style: (K) => HD.brush(K),
    note: "On white, the head cocked the other way." });

  HD.HANG = V;
})();
