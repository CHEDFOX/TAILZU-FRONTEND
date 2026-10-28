package expo.modules.tulmishare

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.UUID

/**
 * The app's half of sharing into Tailzu on Android.
 *
 * Other apps' Share menus open MainActivity with ACTION_SEND or
 * ACTION_SEND_MULTIPLE (the filters are added by plugin/withTulmiShare.js).
 * This reads that intent ONCE: words (EXTRA_TEXT, EXTRA_SUBJECT) as they are,
 * and each shared file (EXTRA_STREAM) copied into the app's cache while the
 * sender's read grant is still alive, so the uploader can send it from there.
 *
 * Returns the same shape as the iPhone's module:
 *   { items: [{ type: "text", text } | { type: "file", uri: "file://…", name, mime, bytes }], skipped }
 * or null when the activity was not opened by a share (or that share was
 * already taken). Links arrive as text; the app tells them apart.
 *
 * A share that arrives while the app runs (singleTask: onNewIntent) is held
 * and announced with "onShare", so the app can take it at once.
 */
class TulmiShareModule : Module() {
  /** A share delivered to the running activity, not yet taken. */
  private var fresh: Intent? = null

  override fun definition() = ModuleDefinition {
    Name("TulmiShare")

    Events("onShare")

    OnNewIntent { intent ->
      if (isShare(intent)) {
        fresh = intent
        sendEvent("onShare", mapOf("at" to System.currentTimeMillis().toDouble()))
      }
    }

    // `maxAgeMs` is the iPhone's (how old a waiting share may be); an intent
    // here is always the one the activity has now, so it is not used.
    Function("consumeShared") { _: Double? ->
      val ctx = appContext.reactContext ?: return@Function null
      val intent = fresh ?: appContext.currentActivity?.intent
      fresh = null
      if (intent == null || !isShare(intent) || intent.getBooleanExtra(TAKEN, false)) return@Function null
      // Opened again from Recents, the activity is handed the old share again.
      if (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return@Function null
      intent.putExtra(TAKEN, true)
      read(ctx, intent)
    }
  }

  private fun isShare(intent: Intent?): Boolean =
    intent != null && (intent.action == Intent.ACTION_SEND || intent.action == Intent.ACTION_SEND_MULTIPLE)

  private fun read(ctx: Context, intent: Intent): Map<String, Any> {
    val items = mutableListOf<Map<String, Any>>()
    var skipped = 0
    // A page's title and its address come as SUBJECT and TEXT: two items, so
    // the app can see the address on its own.
    intent.getStringExtra(Intent.EXTRA_SUBJECT)?.trim()?.takeIf { it.isNotEmpty() }?.let {
      items.add(mapOf("type" to "text", "text" to it.take(MAX_TEXT)))
    }
    intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.trim()?.takeIf { it.isNotEmpty() }?.let {
      items.add(mapOf("type" to "text", "text" to it.take(MAX_TEXT)))
    }
    val uris = streams(intent)
    val dir = File(File(ctx.cacheDir, "share-in"), UUID.randomUUID().toString())
    for ((i, uri) in uris.withIndex()) {
      if (i >= MAX_FILES) { skipped++; continue }
      val file = try { copy(ctx, uri, dir) } catch (_: Exception) { null }
      if (file != null) items.add(file) else skipped++
    }
    return mapOf("items" to items, "skipped" to skipped)
  }

  @Suppress("DEPRECATION")
  private fun streams(intent: Intent): List<Uri> {
    val out = mutableListOf<Uri>()
    if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
      val list: List<Uri>? = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
      list?.let { out.addAll(it) }
    } else {
      val one: Uri? = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
      one?.let { out.add(it) }
    }
    // Some senders put the files only in the ClipData.
    if (out.isEmpty()) intent.clipData?.let { clip -> for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let { out.add(it) } }
    return out.distinct()
  }

  /** The shared file, copied into the cache. Null: not a file we may read, unreadable, or too big. */
  private fun copy(ctx: Context, uri: Uri, dir: File): Map<String, Any>? {
    // NEVER a file:// path, and never one of this app's own providers: a
    // "share" naming the app's own files (its shared_prefs hold the keyboard's
    // token) would otherwise be read and sent off by the app itself.
    if (uri.scheme != ContentResolver.SCHEME_CONTENT) return null
    val authority = uri.authority ?: return null
    if (authority == ctx.packageName || authority.startsWith(ctx.packageName + ".")) return null
    val cr = ctx.contentResolver
    var name: String? = null
    var size = -1L
    cr.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
      if (c.moveToFirst()) {
        val n = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (n >= 0 && !c.isNull(n)) name = c.getString(n)
        val s = c.getColumnIndex(OpenableColumns.SIZE)
        if (s >= 0 && !c.isNull(s)) size = c.getLong(s)
      }
    }
    if (size > MAX_BYTES) return null
    val mime = cr.getType(uri) ?: "application/octet-stream"
    if (!dir.exists() && !dir.mkdirs()) return null
    var out = File(dir, safeName(name ?: uri.lastPathSegment ?: "file", mime))
    var n = 1
    while (out.exists()) {
      n++
      val base = out.nameWithoutExtension
      val ext = out.extension
      out = File(dir, if (ext.isEmpty()) "$base $n" else "$base $n.$ext")
    }
    var total = 0L
    val input = cr.openInputStream(uri) ?: return null
    input.use { src ->
      out.outputStream().use { dst ->
        val buf = ByteArray(64 * 1024)
        while (true) {
          val r = src.read(buf)
          if (r < 0) break
          total += r
          if (total > MAX_BYTES) {
            dst.close()
            out.delete()
            return null
          }
          dst.write(buf, 0, r)
        }
      }
    }
    if (total <= 0L) { out.delete(); return null }
    return mapOf("type" to "file", "uri" to Uri.fromFile(out).toString(), "name" to out.name, "mime" to mime, "bytes" to total.toDouble())
  }

  /** Only a name: no folders, nothing odd, not too long, with an extension for its type. */
  private fun safeName(raw: String, mime: String): String {
    var base = raw.substringAfterLast('/').replace(Regex("[^\\p{L}\\p{N} ._()-]"), "_").trim(' ', '.')
    if (base.isEmpty()) base = "file"
    base = base.take(100)
    if (base.contains('.')) return base
    val ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)
    return if (ext.isNullOrEmpty()) base else "$base.$ext"
  }

  companion object {
    private const val TAKEN = "tailzu.share.taken"
    private const val MAX_FILES = 5
    private const val MAX_BYTES = 50L * 1024 * 1024
    private const val MAX_TEXT = 6000
  }
}
