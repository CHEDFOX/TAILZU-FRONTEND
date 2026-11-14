package expo.modules.tulmiperms

import java.util.Locale
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * THE STEP LEDGER, ON THE JVM (perms2/SPEC.md 5.1; Android half, build 8.9.1).
 *
 * `TulmiMotionSteps.fold` and `dayKey` are pure, and they are mirrored in
 * `src/device/androidMotionCore.ts` (`foldCounter`, `dayKey`) so the rules can be read in one place
 * by anyone working on the JavaScript. **A change to one is a change to both**, and this file is
 * what makes a drift fail rather than ship: every case here has the same numbers as the Node test.
 *
 * Nothing here touches a Context, a sensor or SharedPreferences, so it runs as an ordinary unit test
 * (`./gradlew :tulmi-perms:test`). It needs `testImplementation 'junit:junit:4.13.2'` in the
 * module's build.gradle — see ANDROID-WIRING.md §3.
 */
class TulmiMotionStepsTest {
  private val was: Locale = Locale.getDefault()

  @After fun restore() = Locale.setDefault(was)

  private fun empty() = TulmiMotionSteps.fold(
    TulmiMotionSteps.Ledger("", 0, 0, -1, -1, emptyMap()),
    0,
    "",
  )

  private fun first(counter: Long, day: String, boot: Long = -1L) =
    TulmiMotionSteps.fold(TulmiMotionSteps.Ledger("", 0, 0, -1, -1, emptyMap()), counter, day, boot)

  // ------------------------------------------------------------------ the day key is a wire format

  @Test
  fun `the day key is ASCII digits whatever the phone's language is`() {
    // 00:30 UTC on the 14th is 06:00 on the 14th in +05:30.
    val at = 1794616200000L // 2026-11-14T00:30:00Z
    for (tag in listOf("bn-IN", "mr-IN", "ar-EG", "fa-IR", "ne-NP", "my-MM", "en-US")) {
      Locale.setDefault(Locale.forLanguageTag(tag))
      val key = TulmiMotionSteps.dayKey(at, 330)
      assertEquals("$tag wrote the day in its own digits", "2026-11-14", key)
      assertTrue(
        "$tag: the key must match the JavaScript's ^\\d{4}-\\d{2}-\\d{2}$, whose \\d is ASCII",
        Regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}$").matches(key),
      )
    }
  }

  @Test
  fun `the day is the phone's local day, not UTC's`() {
    val at = 1794616200000L // 2026-11-14T00:30:00Z
    Locale.setDefault(Locale.forLanguageTag("bn-IN"))
    assertEquals("2026-11-14", TulmiMotionSteps.dayKey(at, 330))
    assertEquals("2026-11-13", TulmiMotionSteps.dayKey(at, -360))
  }

  // ------------------------------------------------------------------------------- the ledger

  @Test
  fun `the first read ever claims nothing`() {
    val l = first(9_000, "2026-11-14")
    assertEquals(0L, TulmiMotionSteps.today(l))
    assertEquals("2026-11-14", l.day)
    assertTrue(l.totals.isEmpty())
    // A reading with no day changes nothing at all.
    assertEquals(l, TulmiMotionSteps.fold(l, 9_500, ""))
    assertEquals(TulmiMotionSteps.today(empty()), 0L)
  }

  @Test
  fun `steps since the first read are today's`() {
    var l = first(9_000, "2026-11-14")
    l = TulmiMotionSteps.fold(l, 9_450, "2026-11-14")
    assertEquals(450L, TulmiMotionSteps.today(l))
    l = TulmiMotionSteps.fold(l, 11_000, "2026-11-14")
    assertEquals(2_000L, TulmiMotionSteps.today(l))
  }

  @Test
  fun `a day is closed at its own last read, not at the next day's read`() {
    var l = first(1_000, "2026-11-13")
    l = TulmiMotionSteps.fold(l, 5_000, "2026-11-13") // 4000 on the 13th, at its last read
    l = TulmiMotionSteps.fold(l, 5_600, "2026-11-14") // the first read of the 14th
    // 4000, NOT 4600: the 600 between the two reads straddles midnight and belongs to nobody.
    assertEquals(mapOf("2026-11-13" to 4_000L), l.totals)
    assertEquals(0L, TulmiMotionSteps.today(l))
    l = TulmiMotionSteps.fold(l, 6_000, "2026-11-14")
    assertEquals(400L, TulmiMotionSteps.today(l))
  }

  @Test
  fun `a gap of days does not pin those days' steps on the last day read`() {
    // Health sync runs on page appear, so not opening X0 Bot for a few days is ordinary.
    var l = first(1_000, "2026-11-13")
    l = TulmiMotionSteps.fold(l, 1_500, "2026-11-13")
    l = TulmiMotionSteps.fold(l, 41_500, "2026-11-17") // four days of walking in one reading
    assertEquals(mapOf("2026-11-13" to 500L), l.totals)
    assertEquals(0L, TulmiMotionSteps.today(l))
    // The 40,000 steps of the 14th, 15th and 16th are not claimed for ANY day. A fabricated daily
    // total would be worse than a missing one: the server's day stays as it was (androidMotionCore).
    assertTrue(l.totals.keys.none { it > "2026-11-13" })
  }

  @Test
  fun `a reboot keeps what was counted and takes the restarted counter as steps since`() {
    var l = first(9_000, "2026-11-14")
    l = TulmiMotionSteps.fold(l, 9_500, "2026-11-14") // 500 today
    l = TulmiMotionSteps.fold(l, 120, "2026-11-14") // the counter restarted at boot
    assertEquals(620L, TulmiMotionSteps.today(l))
    l = TulmiMotionSteps.fold(l, 300, "2026-11-14")
    assertEquals(800L, TulmiMotionSteps.today(l))
  }

  @Test
  fun `a reboot across midnight closes the old day at its last read`() {
    var l = first(20_000, "2026-11-13")
    l = TulmiMotionSteps.fold(l, 23_000, "2026-11-13") // 3000 on the 13th
    l = TulmiMotionSteps.fold(l, 80, "2026-11-14") // rebooted overnight
    assertEquals(mapOf("2026-11-13" to 3_000L), l.totals)
    assertEquals(0L, TulmiMotionSteps.today(l))
    for (v in l.totals.values) assertTrue(v >= 0)
  }

  @Test
  fun `the boot count catches a reboot the counter cannot show`() {
    // The counter reading is HIGHER than the last one although the phone restarted: the person
    // walked more after the reboot than they had before it. `counter < last` sees nothing here.
    var l = first(1_000, "2026-11-14", boot = 7)
    l = TulmiMotionSteps.fold(l, 1_200, "2026-11-14", boot = 7) // 200 today
    l = TulmiMotionSteps.fold(l, 5_000, "2026-11-14", boot = 8) // rebooted, then 5000 steps
    assertEquals(5_200L, TulmiMotionSteps.today(l))
    assertEquals(8L, l.boot)
    // Without the boot count it would have read 1000..5000 as one run and said 4200.
    val blind = TulmiMotionSteps.fold(
      TulmiMotionSteps.Ledger("2026-11-14", 1_000, 0, 1_200, -1, emptyMap()),
      5_000,
      "2026-11-14",
      -1,
    )
    assertEquals(4_000L, TulmiMotionSteps.today(blind))
  }

  @Test
  fun `the ledger keeps 31 days, oldest dropped first`() {
    val day = { i: Int -> TulmiMotionSteps.dayKey(1767225600000L + i * 86_400_000L, 0) }
    var l = first(0, day(0))
    for (i in 1..40) l = TulmiMotionSteps.fold(l, i * 1_000L, day(i))
    val days = l.totals.keys.sorted()
    assertEquals(TulmiMotionSteps.MAX_DAYS, days.size)
    assertEquals(day(39), days.last())
    assertEquals(day(9), days.first())
  }
}
