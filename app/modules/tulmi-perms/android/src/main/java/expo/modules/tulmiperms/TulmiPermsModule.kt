package expo.modules.tulmiperms

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Geocoder
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.ContactsContract
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale

/**
 * The Android half of "Add from contacts" and "Use my location" (perms/SPEC.md 2, 3, 6.2).
 *
 * pickEmail()           ACTION_PICK on Email.CONTENT_TYPE. The Contacts app runs outside this
 *                       app and hands back ONE row this app may read once, so there is no
 *                       READ_CONTACTS, no prompt and no store form. The address book is never
 *                       read, counted or uploaded.
 * locationStatus()      what the system says about ACCESS_COARSE_LOCATION. Never asks. On Android
 *                       it answers "granted", "denied" or "undetermined" and NEVER "blocked":
 *                       nothing but a refused request tells the two apart here.
 * locationAsk()         asks nothing on Android, and answers "granted" or "undetermined" only.
 *                       The JS must ask with PermissionsAndroid, whose never_ask_again is the only
 *                       honest way to tell "blocked" from "refused once"; this exists so the one
 *                       JS path can call the same name on both phones.
 * locationArea(timeout) one fix (the fused provider from Android 12, which the system coarsens for
 *                       an app holding only COARSE; the network provider otherwise and as the
 *                       fallback), then Geocoder, which is the phone's own Google service naming
 *                       the point. Only the area words come back: THE COORDINATE NEVER REACHES
 *                       JAVASCRIPT, and no street, house number or postcode is ever read off the
 *                       address.
 *
 * Nothing here repeats, runs in the background or keeps anything: one fix per tap, as the
 * app's card and the permission's purpose say.
 */
class TulmiPermsModule : Module() {
  /** The one picker in flight, if any: a second call is refused rather than crossing wires. */
  private var picking: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("TulmiPerms")

    AsyncFunction("pickEmail") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject("no_screen", "There is no screen to open the contact picker on.", null)
        return@AsyncFunction
      }
      if (picking != null) {
        promise.reject("busy", "The contact picker is already open.", null)
        return@AsyncFunction
      }
      val intent = Intent(Intent.ACTION_PICK).apply {
        type = ContactsContract.CommonDataKinds.Email.CONTENT_TYPE
      }
      try {
        picking = promise
        activity.startActivityForResult(intent, PICK_EMAIL)
      } catch (e: Exception) {
        // No Contacts app, or it refused to open: the person types the address instead.
        picking = null
        promise.reject("no_contacts", "This phone has no contact picker.", e)
      }
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != PICK_EMAIL) return@OnActivityResult
      val promise = picking ?: return@OnActivityResult
      picking = null
      val ctx = appContext.reactContext
      val data = payload.data
      if (payload.resultCode != Activity.RESULT_OK || data == null || ctx == null) {
        // Backed out: nothing happened, and the field keeps whatever was typed.
        promise.resolve(null)
        return@OnActivityResult
      }
      promise.resolve(emailOf(ctx, data.data))
    }

    Function("locationStatus") {
      val ctx = appContext.reactContext ?: return@Function "undetermined"
      if (ctx.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
        return@Function "granted"
      }
      // Not held. Android only tells the two apart through the activity: "show a reason" means
      // it was refused once and may be asked again; otherwise it was never asked, or it is off
      // for good, which the JS learns from PermissionsAndroid's never_ask_again when it asks.
      val activity = appContext.currentActivity
      if (activity != null && activity.shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_COARSE_LOCATION)) {
        "denied"
      } else {
        "undetermined"
      }
    }

    // Asks nothing here, and never answers "denied" or "blocked": only PermissionsAndroid's
    // never_ask_again tells those apart, so the JS asks with it on Android and uses this
    // only to see whether the permission is already held.
    AsyncFunction("locationAsk") { promise: Promise ->
      val ctx = appContext.reactContext
      val granted = ctx != null &&
        ctx.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
      promise.resolve(if (granted) "granted" else "undetermined")
    }

    AsyncFunction("locationArea") { timeoutMs: Double, promise: Promise ->
      val ctx = appContext.reactContext
      if (ctx == null) {
        promise.reject("no_context", "The app is not running.", null)
        return@AsyncFunction
      }
      if (ctx.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
        promise.reject("no_fix", "X0 Bot may not see where this phone is.", null)
        return@AsyncFunction
      }
      val wait = if (timeoutMs.isFinite() && timeoutMs > 0) timeoutMs.toLong() else 15_000L
      oneFix(ctx, wait) { spot ->
        if (spot == null) promise.reject("no_fix", "The phone could not say where it is.", null)
        else name(ctx, spot) { parts -> promise.resolve(parts) }
      }
    }
  }

  // ------------------------------------------------------------------ contacts

  /** The one address of the row the Contacts app handed back, or null. The grant dies with this read. */
  private fun emailOf(ctx: Context, row: Uri?): String? {
    if (row == null) return null
    return try {
      ctx.contentResolver.query(
        row,
        arrayOf(ContactsContract.CommonDataKinds.Email.ADDRESS),
        null,
        null,
        null
      )?.use { c ->
        if (!c.moveToFirst()) return@use null
        c.getString(0)?.trim()?.ifEmpty { null }
      }
    } catch (_: Exception) {
      null
    }
  }

  // ------------------------------------------------------------------ one fix, then the words

  /**
   * One location. Never repeats, and COARSE stays the only permission this app holds.
   *
   * From Android 12 the fused provider is open to an app with COARSE alone, and the system
   * coarsens what it hands back. The network provider is the fallback, and on a phone with
   * Google Location Accuracy turned off it is the provider that is off — which used to end
   * in "Couldn't find your area" with GPS on and nothing wrong.
   */
  private fun oneFix(ctx: Context, waitMs: Long, done: (Location?) -> Unit) {
    val manager = ctx.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
    if (manager == null) {
      done(null)
      return
    }
    val provider = pickProvider(manager)
    val answered = java.util.concurrent.atomic.AtomicBoolean(false)
    fun finish(spot: Location?) {
      if (answered.getAndSet(true)) return
      done(spot)
    }
    if (!manager.isProviderEnabled(provider)) {
      // Location is off on the phone itself. The last thing it knew is better than nothing,
      // and the person can always type their area.
      finish(lastKnown(manager, provider))
      return
    }
    val main = Handler(Looper.getMainLooper())
    main.postDelayed({ finish(lastKnown(manager, provider)) }, waitMs)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        manager.getCurrentLocation(provider, null, ctx.mainExecutor) { spot -> finish(spot) }
      } else {
        val listener = object : LocationListener {
          override fun onLocationChanged(spot: Location) {
            manager.removeUpdates(this)
            finish(spot)
          }

          // Kept for Android 10 and below, where the system still calls them.
          override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
          override fun onProviderEnabled(provider: String) = Unit
          override fun onProviderDisabled(provider: String) {
            manager.removeUpdates(this)
            finish(null)
          }
        }
        manager.requestLocationUpdates(provider, 0L, 0f, listener, Looper.getMainLooper())
        main.postDelayed({ manager.removeUpdates(listener) }, waitMs)
      }
    } catch (_: SecurityException) {
      finish(null)
    } catch (_: Exception) {
      finish(null)
    }
  }

  /** The fused provider where this phone has it and it is on, else the network provider. */
  private fun pickProvider(manager: LocationManager): String {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val fused = LocationManager.FUSED_PROVIDER
      val usable = try {
        manager.hasProvider(fused) && manager.isProviderEnabled(fused)
      } catch (_: Exception) {
        false
      }
      if (usable) return fused
    }
    return LocationManager.NETWORK_PROVIDER
  }

  private fun lastKnown(manager: LocationManager, provider: String): Location? = try {
    manager.getLastKnownLocation(provider)
  } catch (_: Exception) {
    null
  }

  /**
   * The phone's own geocoder names the point: on a phone with Google's services that means
   * Google sees it, as part of the phone, not as anything this app sends. Without a backend
   * (Geocoder.isPresent false, or nothing comes back) the answer is null and the person types
   * their area, exactly as today.
   */
  private fun name(ctx: Context, spot: Location, done: (Map<String, String>?) -> Unit) {
    if (!Geocoder.isPresent()) {
      done(null)
      return
    }
    val geocoder = Geocoder(ctx, Locale.getDefault())
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      geocoder.getFromLocation(spot.latitude, spot.longitude, 1, object : Geocoder.GeocodeListener {
        override fun onGeocode(addresses: MutableList<android.location.Address>) {
          done(parts(addresses.firstOrNull()))
        }

        override fun onError(message: String?) {
          done(null)
        }
      })
      return
    }
    // The blocking call, off the main thread as its own documentation asks.
    Thread {
      val parts = try {
        @Suppress("DEPRECATION")
        parts(geocoder.getFromLocation(spot.latitude, spot.longitude, 1)?.firstOrNull())
      } catch (_: Exception) {
        null
      }
      done(parts)
    }.start()
  }

  /** The area, in words. thoroughfare, subThoroughfare and postalCode are never read. */
  private fun parts(address: android.location.Address?): Map<String, String>? {
    if (address == null) return null
    val out = LinkedHashMap<String, String>()
    fun put(key: String, value: String?) {
      val v = value?.trim().orEmpty()
      if (v.isNotEmpty()) out[key] = v
    }
    put("subLocality", address.subLocality)
    put("locality", address.locality)
    put("subAdminArea", address.subAdminArea)
    put("adminArea", address.adminArea)
    put("countryCode", address.countryCode)
    return if (out.isEmpty()) null else out
  }

  private companion object {
    const val PICK_EMAIL = 0x7ED1
  }
}
