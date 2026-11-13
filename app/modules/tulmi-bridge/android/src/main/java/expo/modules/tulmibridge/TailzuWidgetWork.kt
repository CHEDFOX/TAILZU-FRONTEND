package expo.modules.tulmibridge

import android.appwidget.AppWidgetManager
import android.content.BroadcastReceiver
import android.content.Intent
import java.util.concurrent.Executors

/**
 * ONE QUEUE, ONE DRAW AT A TIME. Every widget draw that can paint a bitmap or read a design file goes through here, off the
 * main thread, in the order it was asked for.
 *
 * WHY IT HAD TO STOP BEING INLINE. A widget provider's onReceive runs on the app's MAIN thread, and for X0 most of those
 * broadcasts are ours, not the system's: TailzuQuick.requestUpdate fires one on every glance sync, every theme write, every
 * catalog write and after every answer. So while the person is using the app, the UI thread was being asked to read a design
 * off disk and paint its bitmaps. Today's twelve layouts only ever painted the stage bar and got away with it; an nlook design
 * can ask for several masks at once, and that is a dropped frame the person feels in the app they are looking at.
 *
 * WHY SERIAL AND NOT A POOL. Three reasons, all of them about two draws never overlapping:
 *   - NLookPaint's budget and its disk cache have one writer. Two draws at once would each count the other's bitmaps out.
 *   - The newest glance must be the one drawn LAST. A pool would let an older draw finish after a newer one.
 *   - NLookStore.sweep deletes old version folders. Queued behind the draws, it can never delete a folder a draw is reading.
 *
 * Nothing here ever throws. A queue that cannot take the work runs it on the caller's thread instead, which is exactly what
 * happened before this file existed, so the worst case is today's behaviour and never a widget that does not draw.
 */
internal object TailzuWork {
  private val queue = try {
    Executors.newSingleThreadExecutor { r ->
      Thread(r, "tailzu-widgets").apply {
        isDaemon = true
        priority = Thread.NORM_PRIORITY - 1
      }
    }
  } catch (_: Throwable) {
    null
  }

  /** Put it on the queue. On the caller's thread if there is no queue at all, because a draw missed is a blank widget. */
  fun post(block: () -> Unit) {
    val q = queue
    if (q == null) {
      guard(block)
      return
    }
    try {
      q.execute { guard(block) }
    } catch (_: Throwable) {
      guard(block)
    }
  }

  /**
   * The same, for a broadcast: goAsync() keeps the process alive while the queue gets to it, and the pending result is
   * finished exactly once however the work ends. A receiver that never finishes its result is an ANR.
   */
  fun receive(pending: BroadcastReceiver.PendingResult?, block: () -> Unit) {
    if (pending == null) {
      post(block)
      return
    }
    post {
      try {
        block()
      } finally {
        try {
          pending.finish()
        } catch (_: Throwable) {
        }
      }
    }
  }

  /**
   * The widget ids a draw broadcast is about, or null when this is not one of the two that draw. It is exactly what
   * AppWidgetProvider.onReceive reads before it calls onUpdate or onAppWidgetOptionsChanged, lifted out so a provider can
   * answer the broadcast on the queue instead of on the main thread. Everything else — DELETED, ENABLED, DISABLED, our
   * own button presses — is cheap and stays inline with `super.onReceive`.
   */
  fun widgetIds(intent: Intent): IntArray? {
    val extras = intent.extras ?: return null
    return when (intent.action) {
      AppWidgetManager.ACTION_APPWIDGET_UPDATE ->
        extras.getIntArray(AppWidgetManager.EXTRA_APPWIDGET_IDS)?.takeIf { it.isNotEmpty() }
      AppWidgetManager.ACTION_APPWIDGET_OPTIONS_CHANGED ->
        extras.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
          .takeIf { it != AppWidgetManager.INVALID_APPWIDGET_ID }
          ?.let { intArrayOf(it) }
      else -> null
    }
  }

  private fun guard(block: () -> Unit) {
    try {
      block()
    } catch (_: Throwable) {
      // A widget never stops the app, and least of all from a thread nobody is waiting on.
    }
  }
}
