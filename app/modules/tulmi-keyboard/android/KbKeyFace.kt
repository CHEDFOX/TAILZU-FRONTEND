package com.tulmi.app.keyboard

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.DashPathEffect
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import org.json.JSONArray
import org.json.JSONObject

/**
 * `props.face` — WHAT A KEY PRINTS. [native/SPEC.md §1.6, §4.4;
 * shared/types/keyboardFace.ts KeyFace]
 *
 * Until now a LetterKey could set a title and nothing else, and the one drawn
 * `mark` in the whole keyboard lived inside the mic key. A face gives every
 * key the same vocabulary: a legend, a second legend, a corner glyph, an icon,
 * art, or a drawn mark — behind the key's own title, or instead of it.
 *
 * ONE DRAWABLE, BOTH PATHS. The keyboard draws keys two ways: a Button per key
 * (the view path) and one view per row with the keys painted onto it (the
 * Canvas fast path, kb.render.drawnKeys). A face is a [Drawable] precisely so
 * there is one implementation and not two: the view path layers it under the
 * Button's text, the drawn path calls draw() with the key's painted rect. A
 * print cannot therefore look different depending on a flag.
 *
 * A FACE IS PAINT. It carries no `on`, no action, no endpoint and no layout.
 * The key keeps insertKey, shift casing, the accent tray and the fast in-place
 * re-title, because none of them go anywhere near this file. That is App
 * Review 4.4.1 held by construction rather than by discipline.
 *
 * WHAT NEVER ANIMATES HERE. A non-animated face never starts a display link:
 * this Drawable has no timer, no invalidateSelf loop and no animator. A mark
 * with a `program` is handed to the engine that already ships (the mic key's
 * TulmiMarkView), for at most the budget's few keys; everything else draws its
 * mark at rest, once, and costs exactly one onDraw.
 */
object KbKeyFace {

    /** keyboardFace.ts KEY_FACE_LIMITS.mark.shapes. */
    private const val MAX_SHAPES = 12

    /** A face as the server described it, already clamped. */
    class Face(
        val label: String?,
        val sub: String?,
        val subPos: String,
        val corner: String?,
        val emoji: String?,
        val assetName: String?,
        val artUrl: String?,
        val mark: JSONObject?,
        val program: JSONObject?,
        /** "behind" keeps the key's own title; "instead" replaces it. */
        val layer: String,
        /** The character this key types, for the one-legend rule below. */
        val keyChar: String?,
        val insetDp: Float,
        val font: String?,
        val sizeSp: Float,
        val weight: Int,
        val color: Int?,
        val opacity: Float,
    ) {
        /**
         * ONE LEGEND PER KEY. [H10-Q5]
         *
         * A `label` that is the key's own character, in either case, is not a
         * legend of its own: it says "this key, restyled", so the title keeps
         * its text and follows shift and caps for free. Any OTHER label is a
         * fixed print that replaces the title, under either layer, and never
         * changes case.
         */
        val drawsOwnLegend: Boolean
            get() {
                val l = label ?: return false
                val c = keyChar.orEmpty()
                return !(c.isNotEmpty() && l.equals(c, ignoreCase = true))
            }

        /** Hide the key's own title: a fixed label took its place, or the
         *  face asked to draw instead of it. */
        val replacesTitle: Boolean get() = layer == "instead" || drawsOwnLegend

        /** The face has no legend of its own, so the key's own title is the
         *  legend and takes the face's font, size, weight and colour. */
        val restylesTitle: Boolean get() = !replacesTitle

        /** What this face prints as its own legend, or null when the key's
         *  own title is the legend. An emoji is a picture, not a legend. */
        val ownLegend: String? get() = if (drawsOwnLegend) label else null

        /**
         * Whether this face asks to MOVE. The renderer claims one of the few
         * animation slots for it; in this build nothing starts a display link
         * for an ordinary key — the mark draws at rest — and the mic key keeps
         * the engine it already has.
         */
        val wantsMotion: Boolean get() = program != null
    }

    /**
     * `props.face`, clamped, or null when the key has none — and null in plain
     * mode too, which is how the crash guard turns every face off at once
     * without the renderer knowing anything about the guard.
     */
    fun parse(props: Map<String, Any?>, plainMode: Boolean): Face? {
        if (plainMode) return null
        val o = props["face"] as? JSONObject ?: return null
        val icon = o.opt("icon")
        var emoji: String? = null
        var assetName: String? = null
        when (icon) {
            is String -> emoji = icon.takeIf { it.isNotBlank() }
            is JSONObject -> {
                emoji = icon.optString("emoji", "").takeIf { it.isNotBlank() }
                assetName = icon.optString("asset", "").takeIf { it.isNotBlank() }
                // `icon.url` is deliberately not read. Pictures come through
                // `art`, by content hash, from the manifest; a URL on an icon
                // is refused by the server and ignored here. [H12-Q4]
                // `sf` is an SF Symbol. Android has no such registry, so a key
                // that asks for one falls through to its label rather than
                // drawing a guess at an Apple glyph.
            }
            else -> {}
        }
        val mark = (o.optJSONObject("mark"))?.let { clampMark(it) }
        return Face(
            label = o.optString("label", "").takeIf { it.isNotEmpty() },
            sub = o.optString("sub", "").takeIf { it.isNotEmpty() },
            subPos = o.optString("subPos", "top-right"),
            corner = o.optString("corner", "").takeIf { it.isNotEmpty() },
            emoji = emoji,
            assetName = assetName,
            // Art is the BARE manifest name and nothing else: no host ever
            // travels in a config, and the name must be one the batch
            // fetched. An `icon.url` is not a way in — the server refuses one
            // in a skin, and a picture goes through `art`. [H12-Q4]
            artUrl = KbSkin.artUrlFor(o.optString("art", "").takeIf { it.isNotEmpty() }),
            mark = mark,
            // A program with no mark to move is nothing to run.
            program = if (mark == null) null else o.optJSONObject("program"),
            layer = if (o.optString("layer", "behind") == "instead") "instead" else "behind",
            keyChar = props["char"] as? String,
            insetDp = o.optDouble("inset", 0.0).toFloat().coerceIn(0f, 24f),
            font = o.optString("font", "").takeIf { it.isNotEmpty() },
            sizeSp = o.optDouble("size", 0.0).toFloat().coerceIn(0f, 64f),
            weight = o.optInt("weight", 0).coerceIn(0, 900),
            color = o.optString("color", "").takeIf { it.isNotEmpty() }
                ?.let { runCatching { parseHex(it) }.getOrNull() },
            opacity = o.optDouble("opacity", 1.0).toFloat().coerceIn(0f, 1f),
        )
    }

    /** The mark, with the shape cap applied and unknown kinds dropped. */
    private fun clampMark(o: JSONObject): JSONObject? {
        val vb = o.optJSONArray("viewBox") ?: return null
        if (vb.length() != 4) return null
        if (vb.optDouble(2, 0.0) <= 0.0 || vb.optDouble(3, 0.0) <= 0.0) return null
        val raw = o.optJSONArray("shapes") ?: return null
        val kept = JSONArray()
        for (i in 0 until raw.length()) {
            if (kept.length() >= MAX_SHAPES) break
            val s = raw.optJSONObject(i) ?: continue
            when (s.optString("kind")) {
                "rect", "line", "circle", "path" -> kept.put(s)
                "bars" -> if ((s.optJSONArray("heights")?.length() ?: 0) > 0) kept.put(s)
                else -> {}     // a kind this build does not draw is skipped, not shown
            }
        }
        if (kept.length() == 0) return null
        return JSONObject().put("viewBox", vb).put("shapes", kept)
            .put("fit", o.optString("fit", "circle"))
    }

    /**
     * The Drawable for a face, or null when there is nothing to paint.
     *
     * [tint] is the key's own text colour, used for anything the face did not
     * colour itself, so a face inherits the theme rather than hard-coding ink
     * that goes invisible when the person switches to light.
     *
     * Art is resolved HERE, at build time, not at draw time: a disk read
     * inside onDraw is how a keyboard starts stuttering under a finger. The
     * manifest's one batch has already fetched the file, so this is a cache
     * read; it costs one decode per (file, size) per process.
     */
    fun drawable(context: Context, face: Face, tint: Int): Drawable? {
        val density = context.resources.displayMetrics.density
        val art = face.artUrl?.let { TulmiImageLoader.faceBitmap(context, it, KbSkin.LIMIT_ART_EDGE_PX) }
        val assetId = face.assetName?.let {
            try { context.resources.getIdentifier(it, "drawable", context.packageName) } catch (_: Throwable) { 0 }
        } ?: 0
        val asset = if (assetId == 0) null else try {
            context.resources.getDrawable(assetId, context.theme)
        } catch (_: Throwable) { null }
        val typeface = KbSkin.typeface(context, face.font, face.weight)
        // ownLegend, not label: a label that is the key's own character is
        // drawn by the key's own title (restyled), not by this Drawable, so
        // a face carrying only that has nothing of its own to paint.
        val nothing = art == null && asset == null && face.mark == null &&
            face.ownLegend == null && face.sub == null && face.corner == null && face.emoji == null
        if (nothing) return null
        return FaceDrawable(face, tint, density, context.resources.displayMetrics.scaledDensity, art, asset, typeface)
    }

    /**
     * The face, painted. No state, no timer: given the same bounds it draws
     * the same pixels, which is what lets the view path and the drawn path
     * share it and what keeps a faced key off the display link.
     */
    private class FaceDrawable(
        private val face: Face,
        private val tint: Int,
        private val density: Float,
        private val scaledDensity: Float,
        private val art: Bitmap?,
        private val asset: Drawable?,
        private val typeface: Typeface?,
    ) : Drawable() {

        private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER }
        private val box = RectF()
        private val dst = Rect()
        private val matrix = Matrix()

        private val ink: Int get() = face.color ?: tint

        override fun draw(canvas: Canvas) {
            val inset = face.insetDp * density
            box.set(
                bounds.left + inset, bounds.top + inset,
                bounds.right - inset, bounds.bottom - inset,
            )
            if (box.width() <= 0f || box.height() <= 0f) return
            val alpha = (255 * face.opacity).toInt().coerceIn(0, 255)
            if (alpha == 0) return

            // Art first, then the mark over it, then the words: a print reads
            // back to front, exactly as it was authored.
            art?.let { bmp ->
                paint.reset()
                paint.isFilterBitmap = true
                paint.alpha = alpha
                // Fit inside the key, never crop: a cropped print looks broken
                // and a stretched one looks cheap.
                val s = minOf(box.width() / bmp.width, box.height() / bmp.height)
                val w = bmp.width * s
                val h = bmp.height * s
                dst.set(
                    (box.centerX() - w / 2f).toInt(), (box.centerY() - h / 2f).toInt(),
                    (box.centerX() + w / 2f).toInt(), (box.centerY() + h / 2f).toInt(),
                )
                canvas.drawBitmap(bmp, null, dst, paint)
            }
            asset?.let { d ->
                d.setBounds(box.left.toInt(), box.top.toInt(), box.right.toInt(), box.bottom.toInt())
                d.alpha = alpha
                d.draw(canvas)
            }
            // An emoji is an ICON, not a legend: it is centred and icon-sized
            // like `sf` and `asset`, it follows `layer`, and under "behind"
            // it does NOT stand the key's own title down. An author who wants
            // the emoji alone writes layer: "instead". [H10-Q5 rule 5]
            face.emoji?.let { paintEmoji(canvas, it, alpha) }
            face.mark?.let { paintMark(canvas, it, alpha) }
            paintWords(canvas, alpha)
        }

        /**
         * The mark at rest: every shape at t = 0, in the key's own ink unless
         * the shape named a colour. The artboard is centred in the key; a
         * round key fits it by its DIAGONAL (so a square inside it is not
         * clipped at the rim), `fit: "box"` fits the sides — the same rule the
         * mic key's drawer follows, so a mark looks the same on both.
         */
        private fun paintMark(canvas: Canvas, mark: JSONObject, alpha: Int) {
            val vbA = mark.optJSONArray("viewBox") ?: return
            val vb = FloatArray(4) { vbA.optDouble(it, 0.0).toFloat() }
            if (vb[2] <= 0f || vb[3] <= 0f) return
            val round = mark.optString("fit", "circle") != "box"
            val s = if (round) {
                minOf(box.width(), box.height()) / Math.hypot(vb[2].toDouble(), vb[3].toDouble()).toFloat()
            } else {
                minOf(box.width() / vb[2], box.height() / vb[3])
            }
            if (s <= 0f || s.isNaN() || s.isInfinite()) return
            val ox = box.centerX() - (vb[0] + vb[2] / 2f) * s
            val oy = box.centerY() - (vb[1] + vb[3] / 2f) * s
            val shapes = mark.optJSONArray("shapes") ?: return
            for (i in 0 until shapes.length()) {
                val o = shapes.optJSONObject(i) ?: continue
                paint.reset()
                paint.isAntiAlias = true
                paint.color = o.optString("color", "").takeIf { it.isNotEmpty() }
                    ?.let { runCatching { parseHex(it) }.getOrNull() } ?: ink
                paint.alpha = (Color.alpha(paint.color) * alpha / 255).coerceIn(0, 255)
                when (o.optString("kind")) {
                    "rect" -> {
                        paint.style = Paint.Style.FILL
                        val r = RectF(
                            ox + o.optDouble("x").toFloat() * s, oy + o.optDouble("y").toFloat() * s,
                            ox + (o.optDouble("x") + o.optDouble("w")).toFloat() * s,
                            oy + (o.optDouble("y") + o.optDouble("h")).toFloat() * s,
                        )
                        val rx = o.optDouble("rx").toFloat() * s
                        canvas.drawRoundRect(r, rx, rx, paint)
                    }
                    "circle" -> {
                        paint.style = Paint.Style.FILL
                        canvas.drawCircle(
                            ox + o.optDouble("cx").toFloat() * s,
                            oy + o.optDouble("cy").toFloat() * s,
                            o.optDouble("r").toFloat() * s, paint,
                        )
                    }
                    "path" -> {
                        val p = KbPath.parse(o.optString("d", "")) ?: continue
                        matrix.setScale(s, s)
                        matrix.postTranslate(ox, oy)
                        p.transform(matrix)
                        val width = o.optDouble("width", 0.0).toFloat() * s
                        if (width > 0f) {
                            paint.style = Paint.Style.STROKE
                            paint.strokeWidth = width
                            paint.strokeCap = capOf(o.optString("cap"))
                            paint.strokeJoin = Paint.Join.ROUND
                        } else {
                            paint.style = Paint.Style.FILL
                        }
                        canvas.drawPath(p, paint)
                    }
                    "bars" -> {
                        val hs = o.optJSONArray("heights") ?: continue
                        val n = hs.length()
                        if (n == 0) continue
                        val x1 = ox + o.optDouble("x1").toFloat() * s
                        val y1 = oy + o.optDouble("y1").toFloat() * s
                        val x2 = ox + o.optDouble("x2").toFloat() * s
                        val y2 = oy + o.optDouble("y2").toFloat() * s
                        val dx = x2 - x1
                        val dy = y2 - y1
                        val len = maxOf(1e-6f, Math.hypot(dx.toDouble(), dy.toDouble()).toFloat())
                        val nx = -dy / len
                        val ny = dx / len
                        paint.style = Paint.Style.STROKE
                        paint.strokeCap = Paint.Cap.BUTT
                        paint.strokeWidth = o.optDouble("thick", 6.0).toFloat() * s
                        for (j in 0 until n) {
                            val f = (j + 0.5f) / n
                            val h = hs.optDouble(j, 0.0).toFloat() * s
                            val cx = x1 + dx * f
                            val cy = y1 + dy * f
                            canvas.drawLine(cx - nx * h / 2, cy - ny * h / 2, cx + nx * h / 2, cy + ny * h / 2, paint)
                        }
                    }
                    else -> {
                        // "line", and anything clampMark let through.
                        paint.style = Paint.Style.STROKE
                        paint.strokeWidth = o.optDouble("width", 1.0).toFloat() * s
                        paint.strokeCap = capOf(o.optString("cap"))
                        o.optJSONArray("dash")?.let { d ->
                            if (d.length() >= 2) {
                                val iv = FloatArray(d.length()) { k -> d.optDouble(k, 0.0).toFloat() * s }
                                if (iv.all { it > 0f }) paint.pathEffect = DashPathEffect(iv, 0f)
                            }
                        }
                        canvas.drawLine(
                            ox + o.optDouble("x1").toFloat() * s, oy + o.optDouble("y1").toFloat() * s,
                            ox + o.optDouble("x2").toFloat() * s, oy + o.optDouble("y2").toFloat() * s, paint,
                        )
                    }
                }
            }
        }

        private fun capOf(name: String): Paint.Cap = when (name) {
            "round" -> Paint.Cap.ROUND
            "square" -> Paint.Cap.SQUARE
            else -> Paint.Cap.BUTT
        }

        /** An emoji, drawn as the icon it is: centred, sized to the box. */
        private fun paintEmoji(canvas: Canvas, emoji: String, alpha: Int) {
            text.reset()
            text.isAntiAlias = true
            text.textAlign = Paint.Align.CENTER
            text.alpha = alpha
            text.textSize = minOf(box.width(), box.height()) * 0.6f
            val fm = text.fontMetrics
            canvas.drawText(emoji, box.centerX(), box.centerY() - (fm.ascent + fm.descent) / 2f, text)
        }

        /**
         * The face's OWN legend, the second legend and the corner glyph.
         *
         * There is no legend here when the key's own title is the legend —
         * the renderer restyles that title instead, so a key never carries
         * two words at once.
         */
        private fun paintWords(canvas: Canvas, alpha: Int) {
            text.reset()
            text.isAntiAlias = true
            text.textAlign = Paint.Align.CENTER
            face.ownLegend?.let { main ->
                text.typeface = typeface
                text.color = ink
                text.alpha = alpha
                text.textSize = (if (face.sizeSp > 0f) face.sizeSp else 16f) * scaledDensity
                val fm = text.fontMetrics
                canvas.drawText(main, box.centerX(), box.centerY() - (fm.ascent + fm.descent) / 2f, text)
            }
            // A second legend and a corner glyph are small, dim and in a
            // corner, which is exactly what they are on every keyboard that
            // has them. The size is a fraction of the main one, not a number
            // of its own, so one `size` moves the whole print together. The
            // corner takes the corner OPPOSITE `sub`, so the two can never
            // land on top of each other — which is what iOS does.
            val small = (if (face.sizeSp > 0f) face.sizeSp else 16f) * 0.55f * scaledDensity
            face.sub?.let { drawCorner(canvas, it, face.subPos, small, alpha) }
            face.corner?.let { drawCorner(canvas, it, opposite(face.subPos), small, alpha) }
        }

        private fun opposite(pos: String): String = when (pos) {
            "top-left" -> "bottom-right"
            "bottom-left" -> "top-right"
            "bottom-right" -> "top-left"
            else -> "bottom-left"          // "top-right", and the default
        }

        private fun drawCorner(canvas: Canvas, s: String, pos: String, size: Float, alpha: Int) {
            text.typeface = typeface
            text.color = ink
            text.alpha = (alpha * 0.7f).toInt().coerceIn(0, 255)
            text.textSize = size
            val pad = 3f * density
            val fm = text.fontMetrics
            val x = if (pos.endsWith("left")) box.left + pad + size / 2f else box.right - pad - size / 2f
            val y = if (pos.startsWith("top")) box.top + pad - fm.ascent else box.bottom - pad - fm.descent
            canvas.drawText(s, x, y, text)
        }

        override fun setAlpha(alpha: Int) {}
        override fun setColorFilter(colorFilter: ColorFilter?) {}
        override fun getOpacity(): Int = PixelFormat.TRANSLUCENT
    }
}
