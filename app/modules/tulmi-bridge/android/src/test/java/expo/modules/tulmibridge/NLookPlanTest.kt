package expo.modules.tulmibridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * THE ANDROID PLANNER, ON THE JVM. No emulator, no launcher, no Android at all: NLookPlan.kt is pure Kotlin precisely so
 * that the rules that keep a widget alive can be asserted in milliseconds.
 *
 * Each test is named after a case in the backend's shared/native/fixtures/designs.json, which is the referee for all five
 * sides (server, phone JS, iOS, Android, keyboard). Where a case's own JSON cannot be read from here — the fixtures live
 * in the other repository — the tree is rebuilt in Kotlin and the case id is written above it, so a disagreement names
 * the fixture to go and look at rather than an opinion.
 *
 * The one rule behind most of them: the launcher unpacks our view tree in ITS process and throws past
 * MAX_NESTED_VIEWS = 10, where our code cannot catch it. The planner has to stop first, every time, whatever it is given.
 */
class NLookPlanTest {

  // ---------------------------------------------------------------- the stand-in for the glance

  /** A glance, a palette and a files folder, as far as the planner can tell. Nothing here touches Android. */
  private class Fake(
    val values: Map<String, String> = emptyMap(),
    val lists: Map<String, Int> = emptyMap(),
    val arts: Set<String> = emptySet(),
    val drawables: Set<String> = emptySet(),
    /** The bots whose own face file the app has already downloaded (files/widget-faces/<face>.png). */
    val botFaces: Set<String> = emptySet(),
    /** Which bot `$bot` and `$color` resolve to, as NLookBind.botFor would answer. */
    val bot: String? = null,
    /** Tokens whose colour is NOT fully opaque: a `border` refuses to draw a ring over one of these. */
    val seeThrough: Set<String> = emptySet(),
  ) : NLookSource {
    override fun fill(template: String, scope: NLookScope?): NLookFilled {
      if (!template.contains("{{")) return NLookFilled(template, false)
      var out = template
      var slots = 0
      var filled = 0
      while (true) {
        val open = out.indexOf("{{")
        if (open < 0) break
        val close = out.indexOf("}}", open)
        if (close < 0) break
        val path = out.substring(open + 2, close)
        slots++
        val v = if (scope != null && path.startsWith(scope.alias + ".")) {
          values[scope.list + "[].".plus(path.substringAfter('.'))] ?: ""
        } else {
          values[path] ?: ""
        }
        if (v.isNotEmpty()) filled++
        out = out.substring(0, open) + v + out.substring(close + 2)
      }
      return NLookFilled(out.trim(), slots > 0 && filled == 0 && !out.any { it.isLetterOrDigit() })
    }

    override fun sensitive(template: String, scope: NLookScope?): Boolean = template.contains("{{job.task}}")
    override fun has(path: String, scope: NLookScope?): Boolean = !values[path].isNullOrEmpty()
    override fun listCount(path: String): Int = (lists[path] ?: 0).coerceAtMost(NLookLimits.EACH_COPIES)
    /** Opaque unless the token is listed see-through, and the LIGHT value carries the token so a test can name it. */
    override fun ink(token: String, scope: NLookScope?): NLookInk? {
      val alpha = if (token in seeThrough) 0x80 else 0xFF
      val base = (token.hashCode() and 0x00FFFFFF)
      return NLookInk((alpha shl 24) or base, (alpha shl 24) or base)
    }

    override fun art(key: String, scope: NLookScope?): String? = if (key in arts) "/files/$key.png" else null
    override fun bundled(src: String): String? = if (src in drawables) src.replace(':', '_') else null
    override fun faceArt(slug: String?): String? = if (slug != null && slug in botFaces) "/files/widget-faces/$slug.png" else null
    override fun dateMs(path: String, scope: NLookScope?): Long? = values[path]?.toLongOrNull()
    override fun relative(path: String, scope: NLookScope?): String = values[path] ?: ""
    override fun botFor(scope: NLookScope?): String? {
      if (scope != null) values[scope.list + "[].slug"]?.takeIf { it.isNotEmpty() }?.let { return it }
      return bot
    }
  }

  private fun where(family: String = "medium", canAnswer: Boolean = true) =
    NLookWhere(family, night = false, case = "working", canAnswer = canAnswer, widthDp = 300f, heightDp = 160f)

  private fun text(template: String, vararg props: Pair<String, Any?>) =
    NLookNode("Text", props = mapOf("text" to template, *props))

  private fun stack(type: String, kids: List<NLookNode>, vararg props: Pair<String, Any?>) =
    NLookNode(type, props = mapOf(*props), children = kids)

  /** Every fragment layout a plan uses, root first, in the order they are added. */
  private fun layouts(node: NLookPlanNode): List<String> {
    val out = ArrayList<String>()
    out.add(node.layout)
    for (kid in node.children) out.addAll(layouts(kid))
    return out
  }

  /** Every set of one kind in a plan, root first. Named `sets` so it never shadows Kotlin's own setOf. */
  private fun <T> sets(node: NLookPlanNode, of: Class<T>): List<T> {
    val out = ArrayList<T>()
    for (s in node.sets) if (of.isInstance(s)) out.add(of.cast(s))
    for (kid in node.children) out.addAll(sets(kid, of))
    return out
  }

  // ---------------------------------------------------------------- the cases

  /** designs.json: ok.minimal — one root, one text, one bound path. */
  @Test
  fun minimalRootPlansToOneTextFragment() {
    val src = Fake(values = mapOf("greeting.hello" to "Evening"))
    val plan = NLookPlanner(src, where()).plan(text("{{greeting.hello}}"))
    assertNotNull(plan)
    assertEquals(1, plan!!.levels)
    assertEquals(1, plan.views)
    assertEquals(listOf("nl_t_sans_400"), layouts(plan.root))
    assertEquals("Evening", sets(plan.root, NLookSet.Words::class.java)[0].value)
  }

  /** designs.json: ok.everyNodeType — one of each, so no side quietly fails to plan one. */
  @Test
  fun everyNodeTypePlansOrDegradesWithoutThrowing() {
    val src = Fake(
      values = mapOf("bots[].name" to "Code bot"),
      lists = mapOf("bots" to 3),
      arts = setOf("bot:code.wave@0.6"),
      drawables = setOf("pose:blip"),
    )
    val root = stack(
      "V",
      listOf(
        stack("H", listOf(NLookNode("Spacer", props = mapOf("min" to 2.0)))),
        stack("Z", listOf(text("x"))),
        stack("Grid", listOf(text("g")), "cols" to 2.0, "gap" to 4.0),
        NLookNode("Image", props = mapOf("src" to "pose:blip", "size" to 20.0)),
        NLookNode("Bot", props = mapOf("who" to "code", "moment" to "wave", "at" to 0.6, "size" to 24.0)),
        NLookNode("Shape", props = mapOf("kind" to "capsule", "fill" to "line"), style = mapOf("h" to 4.0)),
        NLookNode("Bar", props = mapOf("value" to 2.0, "of" to 5.0, "track" to "line")),
        NLookNode("Ring", props = mapOf("value" to 2.0, "of" to 5.0, "width" to 4.0)),
        NLookNode("Kit", props = mapOf("name" to "beads")),
        NLookNode("Each", props = mapOf("of" to "bots", "max" to 3.0, "as" to "it"), children = listOf(text("{{it.name}}"))),
        NLookNode("Button", props = mapOf("open" to "tulmi://home"), children = listOf(text("open"))),
      ),
      "gap" to 4.0,
    )
    val plan = NLookPlanner(src, where("large")).plan(root)
    assertNotNull(plan)
    assertTrue("depth ${plan!!.levels} must fit the cap", plan.levels <= NLookLimits.LEVELS - 1)
    assertTrue("views ${plan.views}", plan.views <= NLookLimits.VIEWS_PER_SIZE)
    // The Each made three copies, the Button kept its click and neither cost a level of its own.
    assertEquals(3, sets(plan.root, NLookSet.Words::class.java).count { it.value == "Code bot" })
    assertEquals(1, sets(plan.root, NLookSet.Click::class.java).size)
  }

  /** designs.json: unknown.node.usesFallback — a format-2 node still reads on a format-1 build. */
  @Test
  fun unknownNodeDrawsItsFallbackAndKeepsItsSibling() {
    val src = Fake(values = mapOf("week.line" to "Four done", "greeting.hello" to "Evening"))
    val root = stack(
      "V",
      listOf(
        NLookNode("Sparkline", props = mapOf("of" to "week.dots"), fallback = text("{{week.line}}")),
        text("{{greeting.hello}}"),
      ),
    )
    val plan = NLookPlanner(src, where()).plan(root)
    assertNotNull(plan)
    val words = sets(plan!!.root, NLookSet.Words::class.java).map { it.value }
    assertEquals(listOf("Four done", "Evening"), words)
  }

  /** designs.json: unknown.node.noFallbackDrawsNothing — nothing there, never a blank widget. */
  @Test
  fun unknownNodeWithoutFallbackDrawsNothingAndKeepsItsSibling() {
    val src = Fake(values = mapOf("greeting.hello" to "Evening"))
    val root = stack("V", listOf(NLookNode("Sparkline"), text("{{greeting.hello}}")))
    val plan = NLookPlanner(src, where()).plan(root)
    assertNotNull(plan)
    assertEquals(listOf("Evening"), sets(plan!!.root, NLookSet.Words::class.java).map { it.value })
  }

  /** designs.json: unknown.styleKey.ignored — never a reason to drop the node. */
  @Test
  fun unknownStyleKeyIsIgnoredAndTheNodeStays() {
    val src = Fake(values = mapOf("summary" to "All quiet"))
    val node = NLookNode("Text", props = mapOf("text" to "{{summary}}"), style = mapOf("glow" to 4.0, "pad" to 8.0))
    val plan = NLookPlanner(src, where()).plan(node)
    assertNotNull(plan)
    assertEquals("All quiet", sets(plan!!.root, NLookSet.Words::class.java)[0].value)
    assertEquals(1, sets(plan.root, NLookSet.PadDp::class.java).size)
  }

  /** designs.json: limit.eachMax.clamped — a bounded repeat over data, never a loop. */
  @Test
  fun eachIsCappedAtEightCopiesHoweverManyAreAsked() {
    val src = Fake(values = mapOf("bots[].name" to "Bot"), lists = mapOf("bots" to 40))
    val root = NLookNode("Each", props = mapOf("of" to "bots", "max" to 40.0, "as" to "it"), children = listOf(text("{{it.name}}")))
    val plan = NLookPlanner(src, where("large")).plan(root)
    assertNotNull(plan)
    assertEquals(NLookLimits.EACH_COPIES, sets(plan!!.root, NLookSet.Words::class.java).size)
    // An Each at a root gets one V of its own and costs no level per copy.
    assertEquals(2, plan.levels)
  }

  /** designs.json: limit.eachList.unknown — Each walks only a list the build knows; an unknown one draws nothing. */
  @Test
  fun eachOverAnUnknownListDrawsNothing() {
    val src = Fake(lists = mapOf("bots" to 3))
    val root = stack("V", listOf(NLookNode("Each", props = mapOf("of" to "planets", "max" to 4.0), children = listOf(text("x")))))
    val plan = NLookPlanner(src, where()).plan(root)
    // The root itself survives, because a root with no `bg` of its own draws the palette's `ground` (H16-Q1) and that
    // is a view. Nothing from the list does: not one copy, not one word.
    assertNotNull(plan)
    assertEquals(listOf("nl_v_start"), layouts(plan!!.root))
    assertEquals(1, plan.views)
  }

  /**
   * designs.json: android.levels.overCap.usesFallback — the one case that is Android's alone. iOS draws this design in
   * full; here the subtree past the cap draws its fallback, because the launcher's own error cannot be caught.
   */
  @Test
  fun aTreeDeeperThanTheCapDrawsItsFallback() {
    val src = Fake(values = mapOf("lock.line" to "Later today"))
    var node: NLookNode = text("deep")
    for (i in 0 until 9) node = stack("V", listOf(node))
    val root = NLookNode("V", children = listOf(node), fallback = text("{{lock.line}}"))
    val plan = NLookPlanner(src, where()).plan(root)
    assertNotNull(plan)
    assertTrue("depth ${plan!!.levels} must stay inside the cap", plan.levels <= NLookLimits.LEVELS - 1)
    // What it could not draw, it gave up on; what it could, it kept. Nothing threw and nothing came back blank.
    assertTrue(plan.views in 1..NLookLimits.VIEWS_PER_SIZE)
  }

  /** The same tree, planned with the whole budget, still stops at the budget it was given. */
  @Test
  fun theLevelBudgetIsWhateverTheCallerSays() {
    val src = Fake()
    var node: NLookNode = text("deep")
    for (i in 0 until 12) node = stack("V", listOf(node))
    for (levels in 2..7) {
      val plan = NLookPlanner(src, where(), levels).plan(node)
      if (plan != null) assertTrue("levels $levels gave ${plan.levels}", plan.levels <= levels)
    }
  }

  /** designs.json: android.grid.flattens — a Grid costs the levels its rows need and not one more. */
  @Test
  fun aGridOfOneRowIsASingleH() {
    val src = Fake()
    val root = stack("Grid", listOf(text("a"), text("b")), "cols" to 2.0, "gap" to 6.0)
    val plan = NLookPlanner(src, where()).plan(root)
    assertNotNull(plan)
    assertEquals("nl_h_start", plan!!.root.layout)
    assertEquals(2, plan.levels)
  }

  @Test
  fun aGridOfSeveralRowsIsAVOfHRowsAndNoCellWrappers() {
    val src = Fake()
    val root = stack("Grid", listOf(text("a"), text("b"), text("c"), text("d")), "cols" to 2.0, "gap" to 6.0)
    val plan = NLookPlanner(src, where()).plan(root)
    assertNotNull(plan)
    assertEquals("nl_v_start", plan!!.root.layout)
    assertEquals(listOf("nl_h_start", "nl_h_start"), plan.root.children.map { it.layout })
    assertEquals(3, plan.levels)
  }

  /** designs.json: button.open.foreignScheme.dropped — a design can never make a widget open another app. */
  @Test
  fun aButtonOpensOnlyOurOwnSchemeOrTheOneHttpsShape() {
    val src = Fake()
    fun clicks(url: String): Int {
      val root = NLookNode("Button", props = mapOf("open" to url), children = listOf(text("go")))
      val plan = NLookPlanner(src, where()).plan(root) ?: return -1
      return sets(plan.root, NLookSet.Click::class.java).size
    }
    assertEquals(1, clicks("tulmi://home"))
    assertEquals(1, clicks("https://github.com/acme/app/pull/4"))
    assertEquals(0, clicks("market://details?id=com.other"))
    assertEquals(0, clicks("https://example.com/"))
    assertEquals(0, clicks("intent://evil#Intent;scheme=http;end"))
  }

  /** designs.json: button.act.known — an answer needs the widgets' own token, and says nothing without it. */
  @Test
  fun anAnswerButtonIsSilentWithoutTheWidgetToken() {
    val src = Fake(values = mapOf("needs.items[0].id" to "n1", "needs.items[0].choices[0].id" to "yes"))
    val root = NLookNode(
      "Button",
      props = mapOf("act" to mapOf("item" to "{{needs.items[0].id}}", "action" to "{{needs.items[0].choices[0].id}}")),
      children = listOf(text("Yes")),
    )
    assertEquals(1, sets(NLookPlanner(src, where(canAnswer = true)).plan(root)!!.root, NLookSet.Click::class.java).size)
    assertEquals(0, sets(NLookPlanner(src, where(canAnswer = false)).plan(root)!!.root, NLookSet.Click::class.java).size)
  }

  /** designs.json: ok.align.acrossTheStack — align is ACROSS the stack on both platforms. */
  @Test
  fun alignIsAcrossTheStack() {
    val src = Fake()
    assertEquals("nl_h_end", NLookPlanner(src, where()).plan(stack("H", listOf(text("a")), "align" to "end"))!!.root.layout)
    assertEquals("nl_v_center", NLookPlanner(src, where()).plan(stack("V", listOf(text("a")), "align" to "center"))!!.root.layout)
  }

  /** designs.json: align.alongTheStack.clamped — "between" is not a value; the node is kept and drawn as start. */
  @Test
  fun anAlignAlongTheStackIsDroppedAndTheNodeDrawsStart() {
    val src = Fake()
    val plan = NLookPlanner(src, where()).plan(stack("H", listOf(text("a")), "align" to "between"))
    assertNotNull(plan)
    assertEquals("nl_h_start", plan!!.root.layout)
  }

  /** A Z aligned anything but start pays one level per child, and gives it up rather than lose the children. */
  @Test
  fun aZAlignedEndWrapsItsChildrenAndStopsWhenThereIsNoRoom() {
    val src = Fake()
    val roomy = NLookPlanner(src, where()).plan(stack("Z", listOf(text("a")), "align" to "end"))
    assertEquals(listOf("nl_z", "nl_zc_end", "nl_t_sans_400"), layouts(roomy!!.root))
    val tight = NLookPlanner(src, where(), 2).plan(stack("Z", listOf(text("a")), "align" to "end"))
    assertEquals(listOf("nl_z", "nl_t_sans_400"), layouts(tight!!.root))
  }

  /** A Spacer is a weighted frame, and which one depends on the stack it is in. */
  @Test
  fun aSpacerTakesTheAxisOfItsStack() {
    val src = Fake()
    val v = NLookPlanner(src, where()).plan(stack("V", listOf(NLookNode("Spacer"), text("a"))))
    assertTrue(layouts(v!!.root).contains("nl_spacer_v"))
    val h = NLookPlanner(src, where()).plan(stack("H", listOf(NLookNode("Spacer"), text("a"))))
    assertTrue(layouts(h!!.root).contains("nl_spacer_h"))
  }

  /** binds.json: a Text whose every slot resolved empty hides, so a hole is never drawn. */
  @Test
  fun aTextThatResolvesEmptyHides() {
    val src = Fake(values = mapOf("greeting.hello" to "Evening"))
    val root = stack("V", listOf(text("{{job.task}}"), text("{{greeting.hello}}")))
    val plan = NLookPlanner(src, where()).plan(root)
    assertEquals(listOf("Evening"), sets(plan!!.root, NLookSet.Words::class.java).map { it.value })
  }

  /** limits: never more views in one size than the contract allows, whatever a design asks for. */
  @Test
  fun aSizeNeverCarriesMoreViewsThanTheCap() {
    val src = Fake(values = mapOf("bots[].name" to "Bot"), lists = mapOf("bots" to 8))
    val rows = ArrayList<NLookNode>()
    for (i in 0 until 20) {
      rows.add(NLookNode("Each", props = mapOf("of" to "bots", "max" to 8.0, "as" to "it"), children = listOf(text("{{it.name}}"))))
    }
    val plan = NLookPlanner(src, where("large")).plan(stack("V", rows))
    assertNotNull(plan)
    assertTrue("views ${plan!!.views}", plan.views <= NLookLimits.VIEWS_PER_SIZE)
    assertEquals(plan.views, NLookPlanner.size(plan.root))
  }

  /** Art that is not on disk takes `alt`, then nothing: the widget has no network and never waits for one. */
  @Test
  fun missingArtFallsToAltAndThenToNothing() {
    val withAlt = NLookNode("Image", props = mapOf("src" to "art:dusk.sky", "alt" to "pose:blip", "size" to 24.0))
    val plan = NLookPlanner(Fake(drawables = setOf("pose:blip")), where()).plan(withAlt)
    assertNotNull(plan)
    assertEquals(1, sets(plan!!.root, NLookSet.Paint::class.java).size)
    assertNull(NLookPlanner(Fake(), where()).plan(withAlt))
  }

  /** paths.json: the grammar is M L Q C Z O, and anything else drops only its own path. */
  @Test
  fun thePathGrammarTakesTheSixCommandsAndNothingElse() {
    assertNotNull(NlPathCore.parse("M 4 12 L 60 12 L 60 20 Z"))
    assertNotNull(NlPathCore.parse("M 0 20 Q 30 0 60 20"))
    assertNotNull(NlPathCore.parse("M 4 12 C 30 2 90 2 116 12"))
    assertNotNull(NlPathCore.parse("O 0 0 0.06 O 0.055 -0.022 0.045"))
    assertNull(NlPathCore.parse("M 0 0 A 10 10 0 0 1 20 20"))
    assertNull(NlPathCore.parse("M 0 0 L 10"))
    assertNull(NlPathCore.parse("M 0 0 L ten 10"))
    assertNull(NlPathCore.parse(buildString { append("M 0 0 "); while (length < 1000) append("L 1 1 ") }))
  }

  /**
   * paths.json, the strict side: `NlPathCore` accepts EXACTLY what `nlookParsePath` in targets/widgets/NLookPath.swift
   * accepts. Every line here was a path the two platforms disagreed about — Android drew something, iPhone drew nothing —
   * and a wrong drawing is worse than a fallback. One assertion per rule, so a regression names the rule it broke.
   */
  @Test
  fun thePathGrammarIsExactlyWhatTheSwiftCoreAccepts() {
    // 1. Every command carries its own letter. `L 1 1 2 2` is not two lines.
    assertNull("no implicit repeats", NlPathCore.parse("M 0 0 L 1 1 2 2"))
    assertNotNull("the letter written out is fine", NlPathCore.parse("M 0 0 L 1 1 L 2 2"))

    // 2. Upper case only: a lower-case letter is a RELATIVE command, and drawing it as absolute is a wrong picture.
    assertNull("lower-case l", NlPathCore.parse("M 0 0 l 5 5"))
    assertNull("lower-case m", NlPathCore.parse("m 0 0 L 5 5"))
    assertNull("lower-case z", NlPathCore.parse("M 0 0 L 5 5 z"))

    // 3. A circle needs a radius.
    assertNull("O with r = 0", NlPathCore.parse("O 1 1 0"))
    assertNull("O with r below zero", NlPathCore.parse("O 1 1 -2"))
    assertNotNull("O with a radius", NlPathCore.parse("O 1 1 2"))

    // 4. Numbers are finite, under 100000, and written in 24 characters or fewer.
    assertNull("too large", NlPathCore.parse("M 0 0 L 100000 1"))
    assertNull("too large, negative", NlPathCore.parse("M 0 0 L -100000 1"))
    assertNotNull("just under", NlPathCore.parse("M 0 0 L 99999 1"))
    assertNull("not finite", NlPathCore.parse("M 0 0 L 1e999 1"))
    assertNull("a token over 24 characters", NlPathCore.parse("M 0 0 L 1.00000000000000000000000001 1"))

    // 5. At most 400 segments. Written with `Z`, the one command that is a single character, so both strings stay well
    //    under MAX_CHARS and this is the SEGMENT cap being tested and not the length cap above it.
    assertNotNull(NlPathCore.parse("M0 0" + "Z".repeat(399)))
    assertNull(NlPathCore.parse("M0 0" + "Z".repeat(400)))

    // 6. Space, comma, tab and newline separate numbers. A carriage return does not.
    assertNotNull(NlPathCore.parse("M 0,0\tL\n1 1"))
    assertNull("a carriage return is not a separator", NlPathCore.parse("M 0 0\rL 1 1"))

    // 7. Numbers before any letter, and numbers after a Z, drop the path — as they do on iPhone.
    assertNull("numbers with no letter", NlPathCore.parse("1 2 3 4"))
    assertNull("Z takes none", NlPathCore.parse("M 0 0 Z 1 1"))
  }

  /** limits: a Shape keeps its first twelve paths and still draws. */
  @Test
  fun aShapeKeepsTwelvePaths() {
    val many = (0 until 20).map { "M 0 0 L 1 1" }
    assertEquals(NLookLimits.PATHS_PER_SHAPE, NLookPlanner.pathsOf(many).size)
    assertEquals(0, NLookPlanner.pathsOf(listOf("x".repeat(901))).size)
  }

  /** limits: a text literal is cut at 200 characters rather than dropped — words are the point of the node. */
  @Test
  fun aLongTextIsCutNotDropped() {
    assertEquals(NLookLimits.TEXT_CHARS, nlText("a".repeat(400)).length)
  }

  /** conditions: an AND over keys, each key an OR over its values, and an unknown key ignored. */
  @Test
  fun conditionsAreAnAndOverKeysAndAnUnknownKeyIsIgnored() {
    val src = Fake(values = mapOf("lastDone.pr" to "4"))
    // Whether the Text was planned. The V around it always is — a root with no `bg` draws `ground` (H16-Q1) — so the
    // question is about the child, not about the tree coming back at all.
    fun shows(cond: Map<String, Any?>): Boolean {
      val plan = NLookPlanner(src, where()).plan(stack("V", listOf(NLookNode("Text", props = mapOf("text" to "x"), cond = cond))))
      return plan != null && layouts(plan.root).any { it.startsWith("nl_t_") }
    }

    assertTrue(shows(mapOf("family" to listOf("medium", "large"))))
    assertTrue(shows(mapOf("platform" to "android", "appearance" to "light", "case" to listOf("working"))))
    assertTrue(shows(mapOf("has" to "lastDone.pr")))
    assertTrue(shows(mapOf("sparkles" to true)))
    assertTrue(!shows(mapOf("family" to "small")))
    assertTrue(!shows(mapOf("platform" to "ios")))
    assertTrue(!shows(mapOf("has" to "job.task")))
    assertTrue(!shows(mapOf("reduced" to true)))
  }

  // ---------------------------------------------------------------- the colour of words

  /** ok.text.tint: a colour on words, in the ordinary grammar. */
  @Test
  fun aTextTakesItsOwnTint() {
    val src = Fake()
    val plan = NLookPlanner(src, where()).plan(text("Understand", "tint" to "meta"))
    assertNotNull(plan)
    assertEquals(src.ink("meta", null)!!.light, sets(plan!!.root, NLookSet.TextColor::class.java)[0].ink.light)
  }

  /**
   * ok.text.tint.defaultFromNearestBg: with no `tint`, `ground` over a `bg` of `ink` or `accent` at or above the node,
   * `ink` over anything else. Roles and never luma, so iOS gives the same answer. Before this rule the filled answer
   * pill's label was ink on ink.
   */
  @Test
  fun aTextWithNoTintTakesTheNearestBackground() {
    val src = Fake()
    fun colourUnder(bg: String?): Int {
      val style = if (bg == null) emptyMap() else mapOf<String, Any?>("bg" to bg)
      val root = NLookNode("H", props = mapOf("gap" to 6.0), style = style, children = listOf(text("Yes")))
      val plan = NLookPlanner(src, where()).plan(root)
      assertNotNull(plan)
      return sets(plan!!.root, NLookSet.TextColor::class.java)[0].ink.light
    }

    val ground = src.ink("ground", null)!!.light
    val ink = src.ink("ink", null)!!.light
    assertEquals(ground, colourUnder("ink"))
    assertEquals(ground, colourUnder("accent@0.8"))
    assertEquals(ink, colourUnder("surface"))
    assertEquals(ink, colourUnder(null))
  }

  /** The same default reaches a grandchild: it is the NEAREST bg at or above, not only the node's own. */
  @Test
  fun theNearestBackgroundReachesDownThroughContainers() {
    val src = Fake()
    val deep = stack("V", listOf(stack("H", listOf(text("Yes")))), "gap" to 0.0)
    val root = NLookNode("Z", style = mapOf("bg" to "ink"), children = listOf(deep))
    val plan = NLookPlanner(src, where()).plan(root)
    assertNotNull(plan)
    assertEquals(src.ink("ground", null)!!.light, sets(plan!!.root, NLookSet.TextColor::class.java)[0].ink.light)
  }

  // ---------------------------------------------------------------- the four style keys Android argues about

  /** android.style.maxW.textOnly: carried on a Text, ignored on the H around it (a frame has no maximum). */
  @Test
  fun maxWidthIsCarriedOnTextAndNowhereElse() {
    val root = NLookNode(
      "H",
      props = mapOf("gap" to 6.0),
      style = mapOf("maxW" to 300.0),
      children = listOf(NLookNode("Text", props = mapOf("text" to "a long line"), style = mapOf("maxW" to 170.0))),
    )
    val plan = NLookPlanner(Fake(), where()).plan(root)
    assertNotNull(plan)
    val maxes = sets(plan!!.root, NLookSet.MaxWidthDp::class.java)
    assertEquals(1, maxes.size)
    assertEquals(170f, maxes[0].dp, 0.01f)
  }

  /** android.style.border.drawn: one wrapper level, filled with the ring colour, the node inset on all four sides. */
  @Test
  fun aBorderIsOneWrapperLevel() {
    val src = Fake()
    val root = NLookNode(
      "H",
      props = mapOf("gap" to 6.0),
      style = mapOf("bg" to "surface", "corner" to 14.0, "border" to mapOf("color" to "outline", "width" to 1.0)),
      children = listOf(text("Later")),
    )
    val plan = NLookPlanner(src, where()).plan(root)
    assertNotNull(plan)
    assertEquals("nl_z", plan!!.root.layout)
    assertEquals(src.ink("outline", null)!!.light, sets(plan.root, NLookSet.Background::class.java)[0].ink.light)
    assertEquals("nl_h_start", plan.root.children[0].layout)
    val margin = plan.root.children[0].sets.filterIsInstance<NLookSet.MarginDp>().last()
    assertEquals(1f, margin.start, 0.01f)
    assertEquals(1f, margin.top, 0.01f)
    assertEquals(1f, margin.end, 0.01f)
    assertEquals(1f, margin.bottom, 0.01f)
    // The inner corner is the outer one less the ring's width, so the two curves are concentric.
    assertEquals(13f, plan.root.children[0].sets.filterIsInstance<NLookSet.Corner>().last().dp, 0.01f)
    assertTrue(plan.levels <= NLookLimits.LEVELS)
  }

  /**
   * The ring is drawn INSIDE the node's own frame, as iPhone's `strokeBorder` is, so a bordered pill is the same size as
   * the pill beside it. The wrapper insets the node by `width`, so that same `width` comes back out of the node's padding
   * — otherwise every bordered Text in looks.json would grow by 2 * width on both axes, which stage (b) promised it
   * would not.
   */
  @Test
  fun aBorderTakesItsInsetOutOfTheNodesOwnPadding() {
    val src = Fake()
    val pill = NLookNode(
      "Text",
      props = mapOf("text" to "Later"),
      style = mapOf(
        "bg" to "surface",
        "corner" to 14.0,
        "pad" to listOf(6.0, 12.0, 6.0, 12.0),
        "border" to mapOf("color" to "outline", "width" to 1.0),
      ),
    )
    val plan = NLookPlanner(src, where()).plan(pill)
    assertNotNull(plan)
    assertEquals("nl_z", plan!!.root.layout)
    // top, right, bottom, left — each one dp smaller, so frame = padding + ring = what it was before the ring.
    val pad = plan.root.children[0].sets.filterIsInstance<NLookSet.PadDp>().last().pad
    assertEquals(5f, pad[0], 0.01f)
    assertEquals(11f, pad[1], 0.01f)
    assertEquals(5f, pad[2], 0.01f)
    assertEquals(11f, pad[3], 0.01f)

    // A ring wider than the padding eats all of it rather than going negative.
    val thin = NLookNode(
      "Text",
      props = mapOf("text" to "Later"),
      style = mapOf("bg" to "surface", "pad" to 1.0, "border" to mapOf("color" to "outline", "width" to 4.0)),
    )
    val thinPlan = NLookPlanner(src, where()).plan(thin)
    assertNotNull(thinPlan)
    val zero = thinPlan!!.root.children[0].sets.filterIsInstance<NLookSet.PadDp>().last().pad
    assertTrue("never negative", zero.all { it == 0f })
  }

  /** A `border` with no `width` is 1dp, and 0 to 8, exactly as NLookModel.swift reads it. Matching iPhone is the rule. */
  @Test
  fun aBorderWidthDefaultsToOneAndStopsAtEight() {
    fun ringOf(border: Map<String, Any?>): NLookSet.MarginDp? {
      val node = NLookNode(
        "Text",
        props = mapOf("text" to "Later"),
        style = mapOf("bg" to "surface", "border" to border),
      )
      val plan = NLookPlanner(Fake(), where()).plan(node) ?: return null
      if (plan.root.layout != "nl_z") return null
      return plan.root.children[0].sets.filterIsInstance<NLookSet.MarginDp>().lastOrNull()
    }

    // No width at all: 1dp, drawn. Before this it was 0 and the ring simply did not appear on Android.
    assertEquals(1f, ringOf(mapOf("color" to "outline"))!!.top, 0.01f)
    assertEquals(3f, ringOf(mapOf("color" to "outline", "width" to 3.0))!!.top, 0.01f)
    // Over the top of the range, clamped to 8 rather than to iPhone's old 16.
    assertEquals(8f, ringOf(mapOf("color" to "outline", "width" to 40.0))!!.top, 0.01f)
    // An explicit 0 is "no ring", and stays that way.
    assertNull("an explicit zero draws no ring", ringOf(mapOf("color" to "outline", "width" to 0.0)))
  }

  /**
   * android.style.border.overCap.noRing: the ring is the first thing given up. No level for the wrapper, or no opaque
   * fill to put in the middle, and the node draws WITHOUT its ring rather than not at all.
   */
  @Test
  fun aBorderIsGivenUpBeforeTheNodeIs() {
    val ringed = mapOf<String, Any?>("bg" to "surface", "border" to mapOf("color" to "outline", "width" to 1.0))
    fun deep(levels: Int): NLookNode {
      var node = NLookNode("Text", props = mapOf("text" to "deep"), style = ringed)
      for (i in 0 until levels) node = stack("V", listOf(node))
      return node
    }

    // Six V's above it put the Text on the last level there is (the default budget is LEVELS - 1, so seven): the
    // wrapper would be the eighth. A seventh V would put the Text itself over the cap and the whole tree would be null,
    // which is a different rule and not the one this test is about.
    val over = NLookPlanner(Fake(), where()).plan(deep(6))
    assertNotNull(over)
    assertTrue("no ring over the cap", layouts(over!!.root).none { it == "nl_z" })

    // The same node with room keeps its ring, so the test above is about the cap and not about the node.
    val room = NLookPlanner(Fake(), where()).plan(deep(1))
    assertNotNull(room)
    assertTrue("a ring where it fits", layouts(room!!.root).any { it == "nl_z" })

    // A node with no `bg` of its own at the ROOT: the root draws `ground` (H16-Q1), which IS an opaque fill to put in
    // the middle, so the ring draws. Before that rule there was nothing behind it and the node lost its ring.
    val bare = NLookPlanner(Fake(), where()).plan(
      NLookNode("Text", props = mapOf("text" to "x"), style = mapOf("border" to mapOf("color" to "outline", "width" to 1.0))),
    )
    assertNotNull(bare)
    assertTrue("a root's own ground is a fill to ring over", layouts(bare!!.root).any { it == "nl_z" })

    // A root whose ground is not fully opaque: nothing to paint over the ring colour, so no ring.
    val seeThroughRoot = NLookPlanner(Fake(seeThrough = setOf("ground")), where()).plan(
      NLookNode("Text", props = mapOf("text" to "x"), style = mapOf("border" to mapOf("color" to "outline", "width" to 1.0))),
    )
    assertNotNull(seeThroughRoot)
    assertTrue("no ring over a see-through ground", layouts(seeThroughRoot!!.root).none { it == "nl_z" })

    val faint = NLookPlanner(Fake(seeThrough = setOf("surface")), where()).plan(
      NLookNode("Text", props = mapOf("text" to "x"), style = ringed),
    )
    assertNotNull(faint)
    assertTrue("no ring over a see-through fill", layouts(faint!!.root).none { it == "nl_z" })
  }

  // ---------------------------------------------------------------- which bot a still is of

  /**
   * `$bot` is the BOUND bot, not a template. Putting it through `fill` left the literal "$bot" in the key, so the still
   * was looked for under "bot:$bot.work@0.4" and no Bot node in the catalog ever drew on Android.
   */
  @Test
  fun aBotNodeLooksUpTheBoundBot() {
    val src = Fake(arts = setOf("bot:code.work@0.4"), bot = "code")
    val node = NLookNode("Bot", props = mapOf("who" to "\$bot", "moment" to "work", "at" to 0.4, "size" to 32.0))
    val plan = NLookPlanner(src, where()).plan(node)
    assertNotNull(plan)
    assertEquals("/files/bot:code.work@0.4.png", sets(plan!!.root, NLookSet.Paint::class.java)[0].req.file)

    // With no bot bound, the node's own fallback draws — never a guessed slug, which would be a picture of another bot.
    val none = NLookPlanner(Fake(arts = setOf("bot:blip.work@0.4")), where()).plan(node)
    assertNull(none)
  }

  /**
   * A CARD SHOWS THE BOT WHOSE CARD IT IS. With no still of the bound bot on this phone, the Bot node falls to that bot's
   * own face file, and then to a disc in its own colour — never to the node's `fallback`, which in every bundled design is
   * a pose of the mascot.
   */
  @Test
  fun aBotNodeWithNoStillFallsToThatBotsFaceThenItsDisc() {
    val node = NLookNode(
      "Bot",
      props = mapOf("who" to "\$bot", "moment" to "work", "at" to 0.4, "size" to 32.0),
      fallback = NLookNode("Image", props = mapOf("src" to "pose:rest", "size" to 32.0)),
    )

    // Its own face, as the app downloaded it.
    val face = NLookPlanner(Fake(bot = "code", botFaces = setOf("code"), drawables = setOf("pose:rest")), where()).plan(node)
    assertNotNull(face)
    assertEquals("/files/widget-faces/code.png", sets(face!!.root, NLookSet.Paint::class.java)[0].req.file)

    // Nothing on disk at all: a disc in the bot's own colour, and no picture to paint.
    val disc = NLookPlanner(Fake(bot = "code", drawables = setOf("pose:rest")), where()).plan(node)
    assertNotNull(disc)
    assertEquals(0, sets(disc!!.root, NLookSet.Paint::class.java).size)
    // The bot's own colour lands LAST, over the root's ground, and the corner makes it round.
    val bot = Fake().ink("\$bot.code", null)!!
    assertEquals(bot.light, sets(disc.root, NLookSet.Background::class.java).last().ink.light)
    assertEquals(16f, sets(disc.root, NLookSet.Corner::class.java).last().dp, 0.01f)
  }

  /** Which text fragment a font and weight ask for, and the fall to `sans` for a face the build has no file for. */
  @Test
  fun textFragmentsAreChosenByFaceWeightAndAutosize() {
    assertEquals("nl_t_sans_400", NLookPlanner.textLayout(null, 400, false))
    assertEquals("nl_t_mono_500", NLookPlanner.textLayout("mono", 500, false))
    assertEquals("nl_t_sans_800", NLookPlanner.textLayout("sans", 900, false))
    // The three bundled faces, each at the weights there are files for (android/fonts/README.md).
    assertEquals("nl_t_brand_500", NLookPlanner.textLayout("brand", 500, false))
    assertEquals("nl_t_brand_600", NLookPlanner.textLayout("brand", 700, false))
    assertEquals("nl_t_display_600_auto", NLookPlanner.textLayout("display", 600, true))
    assertEquals("nl_t_dots_400", NLookPlanner.textLayout("dots", 400, false))
    // A face with no file of its own is still `sans`, as the contract says a font that cannot register is.
    assertEquals("nl_t_sans_600", NLookPlanner.textLayout("handwriting", 600, false))
  }

  // ---------------------------------------------------------------- what a picture is drawn in

  /**
   * A `path` Shape is painted as a WHITE mask and tinted at apply time, so it MUST leave here with a tint: without one
   * it is white on white by day. The tint is the node's own `fill`, else its `stroke`.
   */
  @Test
  fun aPathMaskCarriesTheColourItWasDrawnIn() {
    val stroked = NLookNode(
      "Shape",
      props = mapOf("kind" to "path", "d" to "M 0 0 L 10 10", "stroke" to "line", "width" to 1.5),
      style = mapOf("w" to 40.0, "h" to 40.0),
    )
    val plan = NLookPlanner(Fake(), where()).plan(stroked)
    assertNotNull(plan)
    val tints = sets(plan!!.root, NLookSet.Tint::class.java)
    assertEquals(1, tints.size)
    assertEquals(Fake().ink("line", null)!!.light, tints[0].ink.light)

    // `fill` wins over `stroke`, and the node's own `tint` wins over both.
    val filled = NLookNode("Shape", props = mapOf("kind" to "path", "d" to "M 0 0 L 1 1", "fill" to "accent", "stroke" to "line"))
    val f = NLookPlanner(Fake(), where()).plan(filled)
    assertEquals(Fake().ink("accent", null)!!.light, sets(f!!.root, NLookSet.Tint::class.java)[0].ink.light)
    val own = NLookNode("Shape", props = mapOf("kind" to "path", "d" to "M 0 0 L 1 1", "fill" to "accent", "tint" to "meta"))
    val o = NLookPlanner(Fake(), where()).plan(own)
    assertEquals(Fake().ink("meta", null)!!.light, sets(o!!.root, NLookSet.Tint::class.java)[0].ink.light)
  }

  /**
   * `dots` and `ring` carry TWO real colours each, so they are painted in them rather than tinted: a tint would say one
   * colour for the filled beads and the hollow ones both.
   */
  @Test
  fun twoToneShapesCarryTheirColoursAndNoTint() {
    val ring = NLookNode("Ring", props = mapOf("value" to 2.0, "of" to 5.0), style = mapOf("w" to 32.0))
    val plan = NLookPlanner(Fake(), where()).plan(ring)
    assertNotNull(plan)
    assertTrue("a ring is not tinted", sets(plan!!.root, NLookSet.Tint::class.java).isEmpty())
    val req = sets(plan.root, NLookSet.Paint::class.java)[0].req
    assertEquals(Fake().ink("accent", null)!!.light, req.fill!!.light)
    assertEquals(Fake().ink("line", null)!!.light, req.stroke!!.light)
  }

  // ---------------------------------------------------------------- the parts of the kit

  /**
   * `Kit beads` is the week's row: `value` filled beads in ink and ONE hollow one after, as today's view draws it. Its
   * value is its own prop and it used to be ignored, so every bead row came out five filled whatever the week held.
   */
  @Test
  fun kitBeadsReadsItsOwnValue() {
    val src = Fake(values = mapOf("week.dots" to "3"))
    val node = NLookNode(
      "Kit",
      props = mapOf("name" to "beads", "props" to mapOf("value" to "{{week.dots}}")),
      style = mapOf("h" to 10.0),
    )
    val plan = NLookPlanner(src, where()).plan(node)
    assertNotNull(plan)
    val req = sets(plan!!.root, NLookSet.Paint::class.java)[0].req
    assertEquals(3, req.value)
    assertEquals(4, req.of)
    assertEquals(src.ink("ink", null)!!.light, req.fill!!.light)
    assertEquals(src.ink("hollow", null)!!.light, req.stroke!!.light)

    // No value at all is a plain row of five, which is what `stripes` has always been.
    val plain = NLookPlanner(Fake(), where()).plan(NLookNode("Kit", props = mapOf("name" to "stripes")))
    assertEquals(0, sets(plain!!.root, NLookSet.Paint::class.java)[0].req.of)
  }

  /** `Kit askBar` is today's ask block: the word, the peek key, and a tap on each. Not an empty capsule. */
  @Test
  fun kitAskBarDrawsTheWordAndTheKey() {
    val src = Fake(values = mapOf("words.ask" to "Ask any bot…", "links.ask" to "tulmi://screen/bots.ask", "links.mic" to "tulmi://screen/bots.mic"))
    val node = NLookNode("Kit", props = mapOf("name" to "askBar"), style = mapOf("h" to 34.0, "w" to "fill"))
    val plan = NLookPlanner(src, where()).plan(node)
    assertNotNull(plan)
    assertEquals(listOf("nl_h_center", "nl_t_sans_400", "nl_spacer_h", "nl_img_fit"), layouts(plan!!.root))
    assertEquals("Ask any bot…", sets(plan.root, NLookSet.Words::class.java)[0].value)
    val clicks = sets(plan.root, NLookSet.Click::class.java).map { it.click.open }
    assertTrue("the capsule opens Ask", clicks.contains("tulmi://screen/bots.ask"))
    assertTrue("the key opens the mic", clicks.contains("tulmi://screen/bots.mic"))
    assertEquals("tailzu_x0_peek", sets(plan.root, NLookSet.Paint::class.java)[0].req.drawable)
  }

  // ---------------------------------------------------------------- the stage bar

  /**
   * One rule for all three renderers (nlook.ts, "THE PROGRESS BAR"): `of` clamped to 1-8, `color` defaulting to `ink`,
   * and the stage NAMES under the bar when `segments` names EXACTLY `of` of them.
   */
  @Test
  fun aBarClampsToEightAndTakesItsNamesFromSegments() {
    val src = Fake(
      values = mapOf("job.stages[0]" to "Read", "job.stages[1]" to "Plan", "job.stages[2]" to "Write"),
      lists = mapOf("job.stages" to 3),
    )
    val node = NLookNode("Bar", props = mapOf("value" to 2.0, "of" to 3.0, "segments" to "job.stages"), style = mapOf("h" to 4.0))
    val plan = NLookPlanner(src, where()).plan(node)
    assertNotNull(plan)
    val req = sets(plan!!.root, NLookSet.Paint::class.java)[0].req
    assertEquals(listOf("Read", "Plan", "Write"), req.labels!!.names)
    // The picture grows by the label row; the bar itself keeps the 4dp the design asked for.
    assertEquals(4f + NLookBarLabels.ROW_DP, req.hDp, 0.01f)
    // With no colour named the bar is `ink` over `line`, never `accent` (which read as the ink on a dark ground).
    assertEquals(src.ink("ink", null)!!.light, req.fill!!.light)
    assertEquals(src.ink("line", null)!!.light, req.stroke!!.light)

    // A list of another length draws the segments alone, never a half-labelled bar.
    val short = NLookPlanner(Fake(lists = mapOf("job.stages" to 2)), where()).plan(node)
    assertNull(sets(short!!.root, NLookSet.Paint::class.java)[0].req.labels)

    // Twelve stages draw eight segments, not twelve hairlines.
    val many = NLookPlanner(Fake(), where()).plan(NLookNode("Bar", props = mapOf("value" to 11.0, "of" to 12.0)))
    val big = sets(many!!.root, NLookSet.Paint::class.java)[0].req
    assertEquals(8, big.of)
    assertEquals(8, big.value)
  }

  // ---------------------------------------------------------------- a root's own ground

  /** H16-Q1: a widget root that names no `bg` draws exactly as if it said `bg: "ground"`, as it does on iPhone. */
  @Test
  fun aRootWithNoBackgroundDrawsTheGround() {
    val plan = NLookPlanner(Fake(), where()).plan(stack("V", listOf(text("x"))))
    assertNotNull(plan)
    val grounds = sets(plan!!.root, NLookSet.Background::class.java)
    assertEquals(1, grounds.size)
    assertEquals(Fake().ink("ground", null)!!.light, grounds[0].ink.light)

    // A root that names its own `bg` keeps it.
    val own = NLookPlanner(Fake(), where()).plan(stack("V", listOf(text("x"))).let {
      NLookNode("V", props = it.props, style = mapOf("bg" to "surface"), children = it.children)
    })
    assertEquals(Fake().ink("surface", null)!!.light, sets(own!!.root, NLookSet.Background::class.java)[0].ink.light)
  }
}
