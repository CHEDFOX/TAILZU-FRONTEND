package expo.modules.tulmiperms

import android.content.Context
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.StandardIntegrityException
import com.google.android.play.core.integrity.StandardIntegrityManager.PrepareIntegrityTokenRequest
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityTokenProvider
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityTokenRequest
import com.google.android.play.core.integrity.model.StandardIntegrityErrorCode

/**
 * The Android half of abuse and fraud prevention: Google's Play Integrity, and nothing else
 * (perms2/SPEC.md 8.5). Reached through TulmiPermsModule's integrityPrepare / integrityToken.
 *
 * WHAT IT IS FOR, and only for: asking Google whether a request comes from the real X0 Bot,
 * installed by Play, on a real device. The server keeps the ANSWER — recognised or not, device
 * integrity met or not, licensed or not — to score abuse of the free plan, fake accounts, bots
 * and stolen sign-ins. There is no prompt, no usage string and no screen, because nothing about
 * the person is read.
 *
 * WHAT IT MUST NEVER DO. Google's Play Integrity terms forbid using it to "fingerprint or track
 * individual users or devices", so NOTHING here builds a device id, and nothing here reads a
 * device or network trait to stand in for one. No Settings.Secure.ANDROID_ID (getAndroidId), no
 * advertising id, no TelephonyManager, ConnectivityManager or WifiManager, no build
 * fingerprint, no boot time. The whole request Google receives is the request hash the server
 * asked for and the Cloud project number; never an account, email, IP or score (8.2 rule 10).
 * A phone test scans this file for every one of those names (perms2/SPEC.md 12).
 *
 * WHAT IT DOES NOT DECIDE. A missing or failed answer is never a penalty on its own: a phone
 * without Play services, a custom ROM, an EAS preview APK and an emulator all give "no signal"
 * (8.2 rule 6). So every failure here comes back as a short code the JavaScript reports as it
 * is, and the server decides what, if anything, it means.
 *
 * THE FLOW (Play's "standard request"):
 *   prepare(project)  warms up a token provider. Seconds, and Play allows at most 5 a minute per
 *                     install, so the JavaScript calls it only when the bootstrap asks for a
 *                     check, and once. The provider is kept for the life of the process and
 *                     reused for every token after that.
 *   token(hash)       asks that provider for one token over the server's request hash (500 bytes
 *                     at most, which Play enforces too). The token is handed straight back to
 *                     JavaScript, which posts it; it is never logged and never kept here.
 *
 * INTEGRITY_TOKEN_PROVIDER_INVALID means the warmed-up provider has gone stale (Play expires
 * them). This drops the stale one and answers "provider_invalid", which is the JavaScript's cue
 * to prepare once more and retry once — the retry is there, not here, because the step order and
 * the failure codes belong to one place (perms2/SPEC.md 12, J7).
 */
class TulmiTrust {
  /** The warmed-up provider, kept for the process. Null until prepare() has worked. */
  private var provider: StandardIntegrityTokenProvider? = null

  /** Which Cloud project it was warmed up for, so a different one warms up again. */
  private var preparedFor: Long? = null

  /**
   * Warm up a token provider for `cloudProjectNumber` (a number, not a secret; the server sends
   * it in the bootstrap's TrustAsk). Already warmed up for the same project: answers at once.
   */
  fun prepare(ctx: Context, cloudProjectNumber: String, ok: () -> Unit, fail: (String, String) -> Unit) {
    val project = cloudProjectNumber.trim().toLongOrNull()
    if (project == null || project <= 0L) {
      fail("bad_project", "The Cloud project number is not a number.")
      return
    }
    if (provider != null && preparedFor == project) {
      ok()
      return
    }
    val request = PrepareIntegrityTokenRequest.builder().setCloudProjectNumber(project).build()
    try {
      IntegrityManagerFactory.createStandard(ctx)
        .prepareIntegrityToken(request)
        .addOnSuccessListener { warm ->
          provider = warm
          preparedFor = project
          ok()
        }
        .addOnFailureListener { e ->
          provider = null
          preparedFor = null
          val (code, why) = reasonOf(e)
          fail(code, why)
        }
    } catch (e: Exception) {
      // Play services missing altogether, or the service refusing to bind. No signal, not a fault.
      provider = null
      preparedFor = null
      val (code, why) = reasonOf(e)
      fail(code, why)
    }
  }

  /**
   * One integrity token over `requestHash`, which is the server's challenge hashed by the
   * JavaScript. Nothing here reads, changes or keeps it, and nothing here reads the token.
   */
  fun token(requestHash: String, ok: (String) -> Unit, fail: (String, String) -> Unit) {
    val warm = provider
    if (warm == null) {
      fail("not_prepared", "Play Integrity has not been warmed up on this install yet.")
      return
    }
    // Play's own limit. Checked here so a too-long hash is a clear answer, not a Play error.
    if (requestHash.toByteArray(Charsets.UTF_8).size > MAX_HASH_BYTES) {
      fail("hash_too_long", "The request hash is longer than Play Integrity allows.")
      return
    }
    val request = StandardIntegrityTokenRequest.builder().setRequestHash(requestHash).build()
    try {
      warm.request(request)
        .addOnSuccessListener { answer -> ok(answer.token()) }
        .addOnFailureListener { e ->
          val (code, why) = reasonOf(e)
          // A stale provider is the one failure worth clearing: the next prepare() really warms up.
          if (code == "provider_invalid") {
            provider = null
            preparedFor = null
          }
          fail(code, why)
        }
    } catch (e: Exception) {
      val (code, why) = reasonOf(e)
      fail(code, why)
    }
  }

  /**
   * Play's error code as one of our short words, which the JavaScript posts as `failed` and the
   * server reads as "no signal" rather than a penalty. Nothing identifying goes in the message.
   */
  private fun reasonOf(e: Exception): Pair<String, String> {
    val code = (e as? StandardIntegrityException)?.errorCode ?: return Pair("error", "Play Integrity could not answer.")
    return when (code) {
      StandardIntegrityErrorCode.API_NOT_AVAILABLE,
      StandardIntegrityErrorCode.APP_NOT_INSTALLED,
      StandardIntegrityErrorCode.APP_UID_MISMATCH,
      StandardIntegrityErrorCode.CANNOT_BIND_TO_SERVICE,
      -> Pair("unsupported", "Play Integrity is not available on this phone.")

      StandardIntegrityErrorCode.PLAY_STORE_NOT_FOUND,
      StandardIntegrityErrorCode.PLAY_STORE_VERSION_OUTDATED,
      StandardIntegrityErrorCode.PLAY_SERVICES_NOT_FOUND,
      StandardIntegrityErrorCode.PLAY_SERVICES_VERSION_OUTDATED,
      -> Pair("no_play", "This phone has no usable Google Play on it.")

      StandardIntegrityErrorCode.TOO_MANY_REQUESTS -> Pair("throttled", "Play Integrity asked us to slow down.")

      StandardIntegrityErrorCode.NETWORK_ERROR,
      StandardIntegrityErrorCode.GOOGLE_SERVER_UNAVAILABLE,
      StandardIntegrityErrorCode.CLIENT_TRANSIENT_ERROR,
      -> Pair("transient", "Play Integrity could not be reached just now.")

      StandardIntegrityErrorCode.CLOUD_PROJECT_NUMBER_IS_INVALID ->
        Pair("bad_project", "Play Integrity does not know that Cloud project.")

      StandardIntegrityErrorCode.REQUEST_HASH_TOO_LONG ->
        Pair("hash_too_long", "The request hash is longer than Play Integrity allows.")

      StandardIntegrityErrorCode.INTEGRITY_TOKEN_PROVIDER_INVALID ->
        Pair("provider_invalid", "The warmed-up Play Integrity provider has gone stale.")

      else -> Pair("error", "Play Integrity could not answer.")
    }
  }

  private companion object {
    /** Play Integrity's own cap on a standard request's hash. */
    const val MAX_HASH_BYTES = 500
  }
}
