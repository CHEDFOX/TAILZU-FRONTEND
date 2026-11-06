package expo.modules.tulmibridge

/**
 * THE X0 GLANCE'S STEPS: lines that take over at their own minute with no new glance (glanceCore.ts GlanceStep is the rule; the
 * app asks for them with steps=1 only because this binary says glanceSteps, TulmiBridgeModule.kt). A leave-by takes Plan Ease's
 * line at its time, then the next thing, so what the widget says stays true while the app is not opened. X0Doc applies them as
 * it reads the glance, and TailzuX0.step sets the redraw for the next one.
 *
 * From a step's `at` until the next step for the same bot, `line` is that bot's row line; from its `at` until the next step with
 * lock words, `lock` is the lock words. A row that is asking, working or showing something done keeps its own line. Free of
 * Android, so it is the same rule everywhere it runs.
 */
internal object X0Steps {
  /** As many as the app keeps (glanceCore.ts STEPS_MAX). */
  const val MAX = 16

  class Lock(val inline: String, val title: String, val line: String)

  class Step(val at: Long, val bot: String, val line: String, val lock: Lock?)

  /** A step as written, or null when it has no time or sets nothing (a line needs its bot; lock words need a word). */
  fun of(at: Long?, bot: String, line: String, lock: Lock?): Step? {
    if (at == null || at <= 0L) return null
    val hasLine = bot.isNotEmpty() && line.isNotEmpty()
    val words = lock?.takeIf { it.inline.isNotEmpty() || it.title.isNotEmpty() || it.line.isNotEmpty() }
    if (!hasLine && words == null) return null
    return Step(at, if (hasLine) bot else "", if (hasLine) line else "", words)
  }

  /** An idle row's line at `now` from the latest of its steps begun by then; null: the row keeps its own. Steps oldest first. */
  fun line(steps: List<Step>, slug: String, state: String, working: Boolean, now: Long): String? {
    if (state != "idle" || working) return null
    return steps.lastOrNull { it.at <= now && it.bot == slug && it.line.isNotEmpty() }?.line
  }

  /** The lock words at `now` from the latest step begun by then that has them; null: the glance's own. */
  fun lock(steps: List<Step>, now: Long): Lock? = steps.lastOrNull { it.at <= now && it.lock != null }?.lock

  /** When the glance next reads differently on its own, or null. */
  fun next(steps: List<Step>, now: Long): Long? = steps.firstOrNull { it.at > now }?.at
}
