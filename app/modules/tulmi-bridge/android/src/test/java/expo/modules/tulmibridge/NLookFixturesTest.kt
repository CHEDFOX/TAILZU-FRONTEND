package expo.modules.tulmibridge

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * THE SHARED FIXTURES, READ WHERE THEY ARE. `TAILZU-BACKEND/shared/native/fixtures/` is the referee for all five sides —
 * server, phone JS, iOS, Android and the keyboard — and this file runs the Android half of it against the real files
 * rather than against a copy.
 *
 * NO COPY, ON PURPOSE. A copy in this repository would be a third version of the truth and would need its own sync check.
 * The app's own JS already reads the backend's fixtures across the two checkouts (src/native/looksCore.test.ts), so this
 * does the same: `nlook.fixtures` (a system property set in build.gradle), or the NLOOK_FIXTURES environment variable,
 * points at the folder. With neither, and with no sibling checkout, every test here SKIPS with a message and none of them
 * quietly passes — CI gets the folder from its own checkout step.
 *
 * What is asserted here is only what Android alone decides: RemoteViews levels, views per size, Each copies, and the
 * `android` object a case carries (a ring, an align, a level ceiling). The verdicts themselves — ok, clamped, dropped,
 * skipped — are the server's `clean` to enforce; this side only has to agree about what it draws.
 *
 * NLookPlanTest.kt rebuilds some of these trees in Kotlin, where a case needs planner-only facts. The last test here is
 * the thread between the two: every case id those tests name must still exist in the fixtures, so a renamed case fails
 * loudly instead of drifting into a test that is about nothing.
 */
class NLookFixturesTest {

  /** Case ids that NLookPlanTest.kt rebuilds in Kotlin. Renaming one in the fixtures has to break a test, not drift. */
  private val named = listOf(
    "ok.minimal",
    "ok.everyNodeType",
    "ok.text.tint",
    "ok.text.tint.defaultFromNearestBg",
    "android.style.maxW.textOnly",
    "android.style.border.drawn",
    "android.style.border.overCap.noRing",
    "android.levels.overCap.usesFallback",
    "android.grid.flattens",
    "android.z.alignEnd.wraps",
    "android.z.alignEnd.overCap.drawsStart",
    "limit.eachMax.clamped",
    "button.open.foreignScheme.dropped",
    "button.open.allowed",
    "unknown.node.usesFallback",
    "conditions.allKeys",
  )

  // ------------------------------------------------------------------ finding the folder

  private fun folder(): File {
    val named = System.getProperty("nlook.fixtures") ?: System.getenv("NLOOK_FIXTURES")
    val tried = ArrayList<String>()
    if (!named.isNullOrEmpty()) {
      tried.add(named)
      val f = File(named)
      if (File(f, "designs.json").isFile) return f
    }
    // The sibling checkout, as the app's own JS fixtures already assume.
    var here: File? = File("").absoluteFile
    while (here != null) {
      val guess = File(here, "TAILZU-BACKEND/shared/native/fixtures")
      if (File(guess, "designs.json").isFile) return guess
      here = here.parentFile
    }
    tried.add("a TAILZU-BACKEND checkout beside this one")
    Assume.assumeTrue(
      "shared/native/fixtures not found (looked at: " + tried.joinToString(", ") +
        "). Set NLOOK_FIXTURES to TAILZU-BACKEND/shared/native/fixtures to run the shared cases.",
      false,
    )
    throw IllegalStateException("unreachable")
  }

  private fun read(name: String): JSONObject = JSONObject(File(folder(), name).readText(Charsets.UTF_8))

  private fun cases(file: String): List<JSONObject> {
    val a = read(file).optJSONArray("cases") ?: JSONArray()
    return (0 until a.length()).mapNotNull { a.optJSONObject(it) }
  }

  // ------------------------------------------------------------------ building one case's design

  /**
   * A case's design, with its `generate` block applied. A few cases describe a tree too big or too deep to write out,
   * so the fixture gives the shape instead: a node nested `depth` times with a leaf at the bottom.
   */
  private fun design(case: JSONObject): NLookDesign? {
    val raw = case.optJSONObject("design") ?: return null
    val gen = case.optJSONObject("generate")
    if (gen != null) {
      val root = gen.optString("root", "medium")
      val nest = gen.optJSONObject("nestNode")
      val leaf = gen.optJSONObject("leaf")
      val depth = gen.optInt("depth", 0)
      if (nest != null && leaf != null && depth > 0) {
        var node = JSONObject(leaf.toString())
        for (i in 0 until depth) {
          val up = JSONObject(nest.toString())
          up.put("children", JSONArray().put(node))
          node = up
        }
        val roots = raw.optJSONObject("roots") ?: JSONObject()
        // Whatever the root already carries (its `fallback`) is kept; only the children are generated.
        val existing = roots.optJSONObject(root)
        if (existing != null) {
          existing.put("children", JSONArray().put(node))
        } else {
          roots.put(root, node)
        }
        raw.put("roots", roots)
      }
    }
    return NLookStore.parse(raw)
  }

  private fun where(family: String) =
    NLookWhere(family, night = false, case = "working", canAnswer = true, widthDp = 300f, heightDp = 160f)

  /** A glance that answers everything, so a case is tested for its SHAPE and not for what a fake happens to know. */
  private class Full : NLookSource {
    override fun fill(template: String, scope: NLookScope?): NLookFilled {
      if (!template.contains("{{")) return NLookFilled(template, template.isEmpty())
      var out = template
      while (true) {
        val open = out.indexOf("{{")
        if (open < 0) break
        val close = out.indexOf("}}", open)
        if (close < 0) break
        out = out.substring(0, open) + "x" + out.substring(close + 2)
      }
      return NLookFilled(out.trim(), false)
    }

    override fun sensitive(template: String, scope: NLookScope?): Boolean = false
    override fun has(path: String, scope: NLookScope?): Boolean = true
    override fun listCount(path: String): Int = NLookLimits.EACH_COPIES
    override fun ink(token: String, scope: NLookScope?): NLookInk {
      val base = token.hashCode() and 0x00FFFFFF
      return NLookInk(0xFF000000.toInt() or base, 0xFF000000.toInt() or base)
    }

    override fun art(key: String, scope: NLookScope?): String = "/files/art.png"
    override fun bundled(src: String): String = "tailzu_widget_mark"
    override fun faceArt(slug: String?): String = "/files/widget-faces/code.png"
    override fun dateMs(path: String, scope: NLookScope?): Long = 1_700_000_000_000L
    override fun relative(path: String, scope: NLookScope?): String = "4 min"
    override fun botFor(scope: NLookScope?): String = "code"
  }

  private fun layouts(node: NLookPlanNode): List<String> {
    val out = ArrayList<String>()
    out.add(node.layout)
    for (kid in node.children) out.addAll(layouts(kid))
    return out
  }

  // ------------------------------------------------------------------ the cases

  /**
   * EVERY widget design in the fixtures, planned for every Android root it has, stays inside the caps that keep a widget
   * alive. This is the one that matters: past the launcher's own MAX_NESTED_VIEWS it throws in ITS process, where our
   * code can never catch it, and the person sees "Problem loading widget".
   */
  @Test
  fun everyWidgetCasePlansInsideTheCaps() {
    var planned = 0
    for (case in cases("designs.json")) {
      val id = case.optString("id")
      val verdict = case.optString("expect")
      // A design the server refuses never reaches a phone, and one too new is skipped alone by the store, not here.
      if (verdict == "dropped" || verdict == "skipped") continue
      val d = design(case) ?: continue
      if (d.surface != "widget") continue
      for (family in NLOOK_ANDROID_ROOTS) {
        val root = d.roots[family] ?: continue
        val plan = NLookPlanner(Full(), where(family), NLookLimits.LEVELS).plan(root) ?: continue
        planned++
        assertTrue("$id/$family levels ${plan.levels}", plan.levels <= NLookLimits.LEVELS)
        assertTrue("$id/$family views ${plan.views}", plan.views <= NLookLimits.VIEWS_PER_SIZE)
      }
    }
    assertTrue("the fixtures planned nothing at all", planned > 0)
  }

  /**
   * The `android` object a case carries: what this platform promises about a case that iOS draws in full. Only the keys
   * this side can answer are read, and a key it does not know is ignored, exactly as an unknown anything else is.
   */
  @Test
  fun theAndroidCasesSayWhatTheyPromise() {
    var checked = 0
    for (case in cases("designs.json")) {
      val android = case.optJSONObject("android") ?: continue
      val id = case.optString("id")
      val d = design(case) ?: continue
      for (family in NLOOK_ANDROID_ROOTS) {
        val root = d.roots[family] ?: continue
        val plan = NLookPlanner(Full(), where(family), NLookLimits.LEVELS).plan(root)
        assertNotNull("$id/$family planned nothing", plan)
        val names = layouts(plan!!.root)
        if (android.has("levelsAtMost")) {
          assertTrue("$id/$family levels ${plan.levels}", plan.levels <= android.optInt("levelsAtMost"))
        }
        if (android.has("ring")) {
          // A ring is one wrapper frame around the node, and the only frame these cases can otherwise hold is a Z.
          assertEquals("$id/$family ring", android.optBoolean("ring"), names.contains("nl_z"))
        }
        if (android.has("align")) {
          // A Z whose align is honoured wraps each child; one that is not drops back to start and wraps nothing.
          val wrapped = names.any { it.startsWith("nl_zc_") }
          assertEquals("$id/$family align", android.optString("align") != "start", wrapped)
        }
        if (android.has("offset")) {
          assertTrue("$id/$family offset is iOS only", !android.optBoolean("offset"))
        }
        checked++
      }
    }
    assertTrue("no android.* case was read", checked > 0)
  }

  /** android.style.maxW.textOnly, read from the fixture itself: the ceiling lands on the Text and on nothing else. */
  @Test
  fun maxWidthLandsOnTheTextOnly() {
    val case = cases("designs.json").firstOrNull { it.optString("id") == "android.style.maxW.textOnly" }
    assertNotNull("android.style.maxW.textOnly is gone from the fixtures", case)
    val d = design(case!!)!!
    val root = d.roots["large"] ?: d.roots.values.first()
    val plan = NLookPlanner(Full(), where("large"), NLookLimits.LEVELS).plan(root)
    assertNotNull(plan)
    val maxes = ArrayList<NLookSet.MaxWidthDp>()
    fun walk(node: NLookPlanNode) {
      for (s in node.sets) if (s is NLookSet.MaxWidthDp) maxes.add(s)
      for (kid in node.children) walk(kid)
    }
    walk(plan!!.root)
    assertEquals(1, maxes.size)
    assertEquals(170f, maxes[0].dp, 0.01f)
  }

  /** paths.json: the grammar is shared with the keyboard and the bots' looks, so its cases are read where they live. */
  @Test
  fun thePathGrammarMatchesTheFixtures() {
    var seen = 0
    for (case in cases("paths.json")) {
      val id = case.optString("id")
      val d = case.optString("d")
      val parsed = NlPathCore.parse(d)
      if (case.optString("expect") == "ok") {
        assertNotNull("$id should parse", parsed)
        assertTrue("$id parsed to nothing", parsed!!.isNotEmpty())
      } else {
        assertNull("$id should drop the whole path", parsed)
      }
      seen++
    }
    assertTrue("paths.json read nothing", seen > 0)
  }

  /** The thread to NLookPlanTest: a case it names in Kotlin must still exist, so a rename fails instead of drifting. */
  @Test
  fun everyCaseIdNamedInKotlinStillExists() {
    val have = cases("designs.json").map { it.optString("id") }.toSet()
    val missing = named.filter { it !in have }
    assertTrue("case ids named in NLookPlanTest.kt that the fixtures no longer have: $missing", missing.isEmpty())
  }
}
