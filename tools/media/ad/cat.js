/* The thread: the overhead cat clip with the shoe at the left edge painted out (footage-cat/, from cat-tools/patch.py)
 * and a fine cream thread from the cat's nose to the girl's head, shortening as the cat walks in (the nose tracked per
 * frame by cat-tools/track.py into cat-track.json). The thread sags a little while it is long and draws straighter as
 * it shortens; it casts a soft shadow on the rug (the light is overhead) and has a small knot at each end.
 * Render at the footage's 24 fps:  render.mjs out --page ad/cat.html --ratio 9x16 --fps 24 --name cat */
(() => {
  const q = new URLSearchParams(location.search);
  const FPS = 24, N = 193, DUR = N / FPS, THREAD = "#F6EEDF";
  const json = (url) => new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open("GET", url); x.onload = () => res(JSON.parse(x.responseText)); x.onerror = rej; x.send(); });
  async function start() {
    const W = +(q.get("w") || 1080), H = +(q.get("h") || 1920), u = W / 1080;
    const cv = document.getElementById("c"); cv.width = W; cv.height = H; const ctx = cv.getContext("2d");
    const man = {}; for (let i = 1; i <= N; i++) man[`f${i}`] = new URL(`footage-cat/s${String(i).padStart(4, "0")}.jpg`, location.href).href;
    const A = await X0.load(man), tr = await json(new URL("cat-track.json", location.href).href);
    window.TRAILER = { duration: DUR };
    // the thread's path: a quadratic sag perpendicular to the line, its depth a share of the length (more slack when long)
    function path(c, a, b, len, t) {
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      const sag = Math.min(70, len * 0.09) + 3 * Math.sin(t * 2.3);   // a breath of movement in it
      const nx = -dy / L, ny = dx / L;
      c.beginPath(); c.moveTo(a[0], a[1]); c.quadraticCurveTo(mx + nx * sag, my + ny * sag, b[0], b[1]);
    }
    window.__frame = (t) => {
      ctx.setTransform(u, 0, 0, u, 0, 0); ctx.globalAlpha = 1;
      const n = Math.min(N, Math.round(t * FPS) + 1);
      ctx.drawImage(A[`f${n}`], 0, 0, 1080, 1920);
      const cat = tr.cat[n - 1], girl = tr.girl, len = Math.hypot(girl[0] - cat[0], girl[1] - cat[1]);
      if (len < 18) return;
      ctx.lineCap = "round";
      // the shadow on the rug, a little down and right, soft
      ctx.save(); ctx.translate(7, 9); ctx.filter = "blur(3px)"; ctx.strokeStyle = "rgba(20,0,0,0.45)"; ctx.lineWidth = 5; path(ctx, cat, girl, len, t); ctx.stroke(); ctx.restore();
      // the thread: a cream core with a faint darker edge, so it reads on both the red rug and her dark hair
      ctx.save(); ctx.strokeStyle = "rgba(60,40,30,0.35)"; ctx.lineWidth = 5.5; path(ctx, cat, girl, len, t); ctx.stroke();
      ctx.strokeStyle = THREAD; ctx.lineWidth = 3.2; path(ctx, cat, girl, len, t); ctx.stroke(); ctx.restore();
      // the knots
      for (const p of [cat, girl]) { ctx.fillStyle = THREAD; ctx.beginPath(); ctx.arc(p[0], p[1], 5.5, 0, Math.PI * 2); ctx.fill(); }
    };
    window.__cues = () => [{ at: 0, kind: "sample", file: "cat-sfx/bed.wav", gain: 1 }];
    window.__ready = true;
  }
  start();
})();
