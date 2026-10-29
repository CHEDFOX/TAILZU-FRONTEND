// THE PEEK-A-BOT MIC KEY, for the Keybot frame: the keyboard's real mic key, drawn by the reference drawing code the iOS
// and Android keys are ported from (app/targets/keyboard/PeekBotView.swift, app/modules/tulmi-keyboard/android/TulmiPeekBot.kt).
// Everything between the two "verbatim" lines is copied unchanged from that reference (the Peek-a-bot design page); only the
// still-frame helper at the end is ours. Units: the key's radius is 1, centre (0, 0), y down.
//
//   PeekBot.still(canvas, { mode: "listen" | "idle" (peeking) | "think" | "done", level, seconds })
//   draws one held moment of the key, filling the canvas.
(() => {
  "use strict";
  // ---- verbatim from the reference: begin
  // ---- The bot. Units: the key's radius is 1, centre (0, 0), y down.
  const C = {
    shellTop: "#FBF0DE", shellBottom: "#E9D0A8", body: "#E2C59A", visor: "#1d1c1b", glow: "#FFF1D6",
    clay: "#C9683F", porthole: "#2e2b28",
    hidden: 1.62, peek: 0.86, up: 0.1,          // head centre y when away, peeking, up
    headW: 1.12, headH: 0.86, headR: 0.32, visorW: 0.84, visorH: 0.46, visorR: 0.2, visorY: -0.05,
    eyeX: 0.19, eyeW: 0.12, eyeH: 0.19, stalk: 0.22, ball: 0.075, earR: 0.1, pawR: 0.1, pawX: 0.5,
  };
  const S = (x = 0) => ({ x, v: 0 });
  // Damped spring: rate in rad/s, damp = damping ratio (1 critical). The same in the native ports.
  function spring(s, to, dt, rate, damp) { s.v += ((to - s.x) * rate * rate - 2 * damp * rate * s.v) * dt; s.x += s.v * dt; return s.x; }
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

  function makeBot() {
    return {
      y: S(C.hidden), tilt: S(0), lookX: S(0), lookY: S(0), ant: S(0), ear: S(0), glow: S(0), think: S(0), happy: S(0), paws: S(0),
      blinkIn: 2, blink: 1, peekIn: 1.2, peekLeft: 0, lastMode: "idle", doneAt: 0, time: 0, sparkle: 0,
      // input: { mode: "idle" | "listen" | "think" | "done", level: 0..1, typing: bool }
      update(dt, inp) {
        const b = this; b.time += dt;
        if (inp.mode !== b.lastMode) {
          if (inp.mode === "listen" && b.lastMode === "idle") b.ant.v += 9;      // the pop flicks the antenna
          if (inp.mode === "done") { b.doneAt = b.time; b.sparkle = 1; b.ant.v -= 6; }
          b.lastMode = inp.mode;
        }
        // Peeks: idle only, at random, never while typing.
        if (inp.mode === "idle") {
          if (b.peekLeft > 0) b.peekLeft -= dt;
          else if ((b.peekIn -= dt) <= 0 && !inp.typing) { b.peekLeft = 1.8 + Math.random() * 1.4; b.peekIn = 4 + Math.random() * 5; }
          if (inp.typing) b.peekLeft = Math.min(b.peekLeft, 0.15);
        } else b.peekLeft = 0;
        const peeking = inp.mode === "idle" && b.peekLeft > 0;
        const sinceDone = b.time - b.doneAt;
        const yTo = inp.mode === "listen" || inp.mode === "think" ? C.up
          : inp.mode === "done" ? (sinceDone < 1.1 ? C.up - (sinceDone < 0.25 ? 0.12 : 0) : C.hidden)
          : peeking ? C.peek : C.hidden;
        const pop = yTo < b.y.x;                                           // going up: a quick bouncy pop
        spring(b.y, yTo, dt, pop ? 15 : 9, pop ? 0.42 : 0.8);
        // Look: around while peeking, up-left at the text box while listening, up while thinking.
        const lt = b.time;
        const look = peeking ? [Math.sin(lt * 1.7) * 0.07, -0.02] : inp.mode === "listen" ? [-0.05, -0.04]
          : inp.mode === "think" ? [0.05 * Math.cos(lt * 5), -0.05] : [0, 0];
        spring(b.lookX, look[0], dt, 14, 0.7); spring(b.lookY, look[1], dt, 14, 0.7);
        spring(b.tilt, inp.mode === "listen" ? -0.1 + inp.level * 0.05 : inp.mode === "think" ? 0.06 * Math.sin(lt * 3) : 0, dt, 9, 0.5);
        spring(b.ear, inp.mode === "listen" ? inp.level : 0, dt, 26, 0.6);
        spring(b.glow, inp.mode === "listen" ? 0.35 + inp.level * 0.65 : inp.mode === "think" ? 0.5 + 0.3 * Math.sin(lt * 8) : 0, dt, 22, 0.8);
        spring(b.think, inp.mode === "think" ? 1 : 0, dt, 18, 1);
        spring(b.happy, inp.mode === "done" && sinceDone < 1.3 ? 1 : 0, dt, 20, 1);
        spring(b.paws, peeking ? 1 : 0, dt, 16, 0.9);
        // Antenna: a pendulum hung on the head; the head's vertical speed and tilt drive it.
        spring(b.ant, -b.tilt.x * 1.5 + (inp.mode === "listen" ? Math.sin(lt * 9) * 0.12 * inp.level : 0), dt, 13, 0.18);
        b.ant.v += -b.y.v * 0.6 * dt * 10 * Math.sign(b.ant.x || 0.01) * 0.2;
        b.sparkle = Math.max(0, b.sparkle - dt * 1.1);
        // Blink every few seconds (not while happy).
        b.blinkIn -= dt;
        if (b.blinkIn <= 0) { b.blinkIn = 2.2 + Math.random() * 2.8; b.blinkT = 0.16; }
        if (b.blinkT > 0) { b.blinkT -= dt; b.blink = Math.abs(Math.cos((1 - b.blinkT / 0.16) * Math.PI)); } else b.blink = 1;
        b.level = inp.level;
      },

      draw(c, R) {
        const b = this, u = (v) => v * R;
        // Window
        c.save(); c.beginPath(); c.arc(0, 0, R, 0, 6.2832); c.clip();
        c.fillStyle = C.porthole; c.fillRect(-R, -R, 2 * R, 2 * R);
        const hy = b.y.x, vy = b.y.v;
        // Squash and stretch from vertical speed; a landing squashes.
        const st = clamp(-vy * 0.035, -0.14, 0.2), sy = 1 + st, sx = 1 - st * 0.55;
        c.save(); c.translate(0, u(hy)); c.rotate(b.tilt.x); c.scale(sx, sy);
        // Body: down out of the window
        c.fillStyle = C.body; rr(c, -u(0.34), u(0.3), u(0.68), u(1.4), u(0.2)); c.fill();
        // Ears (behind the shell), pulse with the voice
        const er = C.earR + 0.05 * b.ear.x;
        c.fillStyle = C.clay; disc(c, -u(C.headW / 2), u(-0.02), u(er)); disc(c, u(C.headW / 2), u(-0.02), u(er));
        // Antenna: stalk from the top of the shell, swinging with `ant`
        const ax = Math.sin(b.ant.x) * C.stalk, ay = -C.headH / 2 - Math.cos(b.ant.x) * C.stalk;
        c.strokeStyle = C.shellBottom; c.lineWidth = u(0.05); c.lineCap = "round";
        c.beginPath(); c.moveTo(0, u(-C.headH / 2 + 0.02)); c.quadraticCurveTo(u(ax * 0.2), u(ay + 0.1), u(ax), u(ay)); c.stroke();
        if (b.glow.x > 0.02) { c.fillStyle = C.clay; c.globalAlpha = 0.3 * clamp(b.glow.x); disc(c, u(ax), u(ay), u(C.ball + 0.15 * b.glow.x)); c.globalAlpha = 1; }
        c.fillStyle = C.clay; disc(c, u(ax), u(ay), u(C.ball));
        // Shell: soft cream, lighter on top
        const g = c.createLinearGradient(0, u(-C.headH / 2), 0, u(C.headH / 2));
        g.addColorStop(0, C.shellTop); g.addColorStop(1, C.shellBottom);
        c.fillStyle = g; rr(c, -u(C.headW / 2), -u(C.headH / 2), u(C.headW), u(C.headH), u(C.headR)); c.fill();
        // Shine on the shell
        c.fillStyle = "rgba(255,255,255,0.55)"; rr(c, -u(0.4), -u(0.38), u(0.26), u(0.07), u(0.035)); c.fill();
        // Visor
        c.fillStyle = C.visor; rr(c, -u(C.visorW / 2), u(C.visorY - C.visorH / 2), u(C.visorW), u(C.visorH), u(C.visorR)); c.fill();
        // Face on the visor
        const fx = b.lookX.x, fy = C.visorY + b.lookY.x, th = clamp(b.think.x), hp = clamp(b.happy.x);
        c.fillStyle = C.glow; c.strokeStyle = C.glow; c.shadowColor = "rgba(255,230,190,0.9)"; c.shadowBlur = u(0.12);
        if (hp > 0.5) {               // ^ ^
          c.lineWidth = u(0.06); c.lineCap = "round";
          [-1, 1].forEach((s) => { c.beginPath(); c.arc(u(s * C.eyeX + fx), u(fy + 0.04), u(0.075), Math.PI * 1.15, Math.PI * 1.85); c.stroke(); });
        } else if (th > 0.5) {        // thinking: three dots, bouncing in turn
          for (let i = 0; i < 3; i++) {
            const bounce = Math.max(0, Math.sin(b.time * 7 - i * 0.9)) * 0.06;
            disc(c, u((i - 1) * 0.15 + fx * 0.5), u(fy - bounce), u(0.045));
          }
        } else {                      // eyes: glowing pills that blink
          const eh = C.eyeH * b.blink * (1 + 0.15 * b.ear.x);
          [-1, 1].forEach((s) => { rr(c, u(s * C.eyeX + fx - C.eyeW / 2), u(fy - eh / 2), u(C.eyeW), u(Math.max(0.02, eh)), u(C.eyeW / 2)); c.fill(); });
          if (b.lastMode === "listen") {   // a little mouth that opens with the voice
            const mw = 0.08 + 0.06 * b.level, mh = 0.025 + 0.07 * b.level;
            rr(c, u(fx - mw / 2), u(fy + 0.15 - mh / 2), u(mw), u(mh), u(Math.min(mw, mh) / 2)); c.fill();
          }
        }
        c.shadowBlur = 0;
        c.restore();
        // Paws on the rim while peeking
        if (b.paws.x > 0.02) {
          c.fillStyle = C.shellTop;
          [-1, 1].forEach((s) => { const py = 0.93 - 0.1 * clamp(b.paws.x); disc(c, u(s * C.pawX), u(py), u(C.pawR)); });
        }
        // Sparkle when the words land
        if (b.sparkle > 0) {
          c.save(); c.translate(u(0.55), u(-0.5)); c.rotate((1 - b.sparkle) * 1.5); c.globalAlpha = Math.min(1, b.sparkle * 2);
          const k = u(0.14 * (0.6 + 0.4 * Math.sin(b.sparkle * Math.PI)));
          c.fillStyle = C.glow; c.beginPath();
          for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4, r = i % 2 ? k * 0.32 : k; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
          c.closePath(); c.fill(); c.restore();
        }
        // The rim: a soft inner shadow so the bot sits inside, and a glint on the glass
        const rim = c.createRadialGradient(0, 0, u(0.72), 0, 0, R);
        rim.addColorStop(0, "rgba(0,0,0,0)"); rim.addColorStop(1, "rgba(0,0,0,0.42)");
        c.fillStyle = rim; c.fillRect(-R, -R, 2 * R, 2 * R);
        c.restore();
        c.strokeStyle = "rgba(255,255,255,0.16)"; c.lineWidth = u(0.05); c.lineCap = "round";
        c.beginPath(); c.arc(0, 0, u(0.86), Math.PI * 1.08, Math.PI * 1.38); c.stroke();
      },
    };
  }
  function rr(c, x, y, w, h, r) { r = Math.max(0, Math.min(r, w / 2, h / 2)); c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function disc(c, x, y, r) { c.beginPath(); c.arc(x, y, Math.max(0, r), 0, 6.2832); c.fill(); }
  // ---- verbatim from the reference: end

  /** One held moment: the bot run for `seconds` in `mode` (fixed steps, no randomness left in the pose), drawn at the canvas's size. */
  function still(canvas, o = {}) {
    const mode = o.mode ?? "listen", level = o.level ?? 0.6, steps = Math.round((o.seconds ?? 1.9) / 0.016);
    const bot = makeBot();
    bot.peekIn = 99; bot.blinkIn = 99;
    if (mode === "idle") bot.peekLeft = 99;
    for (let k = 0; k < steps; k++) bot.update(0.016, { mode, level, typing: false });
    const ctx = canvas.getContext("2d"), size = canvas.width;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, size, size); ctx.setTransform(1, 0, 0, 1, size / 2, size / 2);
    bot.draw(ctx, size / 2 - 1);
  }
  window.PeekBot = { still, makeBot, C };
})();
