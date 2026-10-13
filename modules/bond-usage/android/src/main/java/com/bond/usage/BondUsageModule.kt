package com.bond.usage

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import expo.modules.interfaces.taskManager.TaskManagerInterface
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Bridge for Screen Time (read-only). Exposed to JavaScript as "BondUsage".
 * Nothing here can grant Usage Access; only the phone's owner can, in
 * Android Settings. Bond only checks the real state and opens that screen.
 */
class BondUsageModule : Module() {

  private companion object {
    /** Bond's own page inside Accessibility settings (not a public SDK constant). */
    const val ACCESSIBILITY_DETAILS = "android.settings.ACCESSIBILITY_DETAILS_SETTINGS"
  }

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val taskManager: TaskManagerInterface
    get() = appContext.legacyModule<TaskManagerInterface>()
      ?: throw CodedException("ERR_NO_TASK_MANAGER", "expo-task-manager is not available", null)

  override fun definition() = ModuleDefinition {
    Name("BondUsage")

    /**
     * "Currently Using" foreground service (see CurrentAppService). Started
     * only by JavaScript, only when every rule holds, and only while Bond is
     * open (Android doesn't let a background app start a foreground
     * service). Refused without Usage access: nothing is ever bypassed.
     */
    AsyncFunction("startCurrentAppService") { taskName: String, options: Map<String, Any?> ->
      // Usage access is needed only for the app checks (not for battery).
      if (options["watchApps"] != false && !UsageStatsReader.hasUsageAccess(context)) {
        throw Exceptions.MissingPermissions("Usage access")
      }
      val clean = HashMap<String, Any>()
      options.forEach { (k, v) -> if (v != null) clean[k] = v }
      taskManager.registerTask(taskName, CurrentAppTaskConsumer::class.java, clean)
    }

    /** Stop the service and forget the registration (safe to call any time). */
    AsyncFunction("stopCurrentAppService") { taskName: String ->
      val ctx = context
      try {
        if (taskManager.taskHasConsumerOfClass(taskName, CurrentAppTaskConsumer::class.java)) {
          taskManager.unregisterTask(taskName, CurrentAppTaskConsumer::class.java)
        }
      } finally {
        // Also stop it directly, in case the registration was already gone.
        ctx.stopService(Intent(ctx, CurrentAppService::class.java))
      }
    }

    /** Is the service running right now (in this process)? */
    Function("isCurrentAppServiceRunning") { CurrentAppService.running }

    /** Which parts of the running service are on: { apps, battery, screenTime }. */
    Function("getBackgroundServiceModes") {
      val (apps, battery, screenTime) = CurrentAppService.modes()
      mapOf("running" to CurrentAppService.running, "apps" to apps, "battery" to battery, "screenTime" to screenTime)
    }

    /**
     * Turn the app checks / battery / screen time parts of the RUNNING service
     * on or off (works from the background; never starts the service).
     * False = not running.
     */
    Function("updateBackgroundServiceModes") { apps: Boolean, battery: Boolean, screenTime: Boolean ->
      CurrentAppService.updateModes(apps, battery, screenTime)
    }

    /** The local diagnostics log (last 80 lines), newest last. */
    Function("getBackgroundDiagnostics") { BackgroundDiagnostics.read(context) }

    Function("clearBackgroundDiagnostics") { BackgroundDiagnostics.clear(context) }

    /** Add a line from JavaScript (what the task decided), same log. */
    Function("logBackgroundDiagnostic") { message: String ->
      BackgroundDiagnostics.log(context, "js: " + message.take(200))
    }

    /**
     * Which app installed Bond, and the Android version. Android (13+) treats
     * some permissions as "restricted settings" for apps installed outside an
     * app store, and some versions also apply that to Usage access. Android
     * offers no public way to read whether that block is active, so Bond only
     * uses this to explain what MAY be happening; it never claims to know.
     */
    Function("getInstallSource") {
      val ctx = context
      val installer: String? = try {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
          ctx.packageManager.getInstallSourceInfo(ctx.packageName).installingPackageName
        } else {
          @Suppress("DEPRECATION")
          ctx.packageManager.getInstallerPackageName(ctx.packageName)
        }
      } catch (_: Exception) {
        null
      }
      mapOf("installer" to installer, "sdkInt" to android.os.Build.VERSION.SDK_INT)
    }

    /**
     * Live Currently Using (optional accessibility service):
     *  - enabled: the person turned it on in Android's Accessibility settings;
     *  - connected: Android is running it right now (enabled but not
     *    connected = the phone closed it; it comes back when Android restarts
     *    it or Bond is opened);
     *  - lastChangeAt: when it last saw an app switch (ms, 0 = not yet).
     */
    Function("getLiveStatus") {
      val ctx = context
      mapOf(
        "enabled" to BondAppWatchService.isEnabled(ctx),
        "connected" to LiveAppWatch.connected,
        "lastChangeAt" to LiveAppWatch.changedAt.toDouble(),
      )
    }

    /**
     * Backup from the periodic background job: if the background service was
     * on and the phone closed it, start it again (only possible when Android
     * allows it, for example with unrestricted battery use). Never starts
     * anything that was turned off.
     */
    Function("resumeBackgroundService") {
      CurrentAppService.resumeIfWanted(context, "background job")
    }

    /**
     * Open Android's Accessibility settings (the person turns Bond on there).
     * details = true: Bond's own page in Accessibility when this phone offers
     * it ("android.settings.ACCESSIBILITY_DETAILS_SETTINGS"); otherwise, or if
     * it fails, the full list. Returns "details" or "list" (what was opened).
     */
    Function("openAccessibilitySettings") { details: Boolean ->
      val ctx = context
      if (details) {
        val page = Intent(ACCESSIBILITY_DETAILS)
          .putExtra(Intent.EXTRA_COMPONENT_NAME, ComponentName(ctx, BondAppWatchService::class.java).flattenToString())
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val canOpen = try {
          page.resolveActivity(ctx.packageManager) != null
        } catch (_: Exception) {
          false
        }
        if (canOpen) {
          try {
            ctx.startActivity(page)
            return@Function "details"
          } catch (_: Exception) {
            // fall back to the list
          }
        }
      }
      try {
        ctx.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      } catch (_: Exception) {
        ctx.startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
      "list"
    }

    /**
     * Android's own question "Let Bond always run in the background?" (Allow /
     * Deny); the person decides. Falls back to the battery optimization list.
     */
    Function("requestUnrestrictedBattery") {
      val ctx = context
      val ask = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
        .setData(Uri.parse("package:${ctx.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        ctx.startActivity(ask)
        true
      } catch (_: Exception) {
        try {
          ctx.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Exception) {
          // nothing else to open
        }
        false
      }
    }

    /**
     * What Android itself restricts for Bond in the background (for the
     * diagnostics screen; read-only, null = this Android version can't say):
     *  - backgroundRestricted: the person chose "Restricted" battery use;
     *  - dataSaver: "enabled" = Data Saver blocks Bond's background data,
     *    "whitelisted" = Bond is allowed anyway, "disabled" = Data Saver off;
     *  - standbyBucket: how often Android lets Bond run (lower is better).
     */
    Function("getBackgroundRestrictions") {
      val ctx = context
      val sdk = android.os.Build.VERSION.SDK_INT
      val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as? android.app.ActivityManager
      val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as? android.net.ConnectivityManager
      val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as? android.app.usage.UsageStatsManager
      val restricted: Boolean? = if (sdk >= android.os.Build.VERSION_CODES.P) runCatching { am?.isBackgroundRestricted }.getOrNull() else null
      val dataSaver: String? = runCatching {
        when (cm?.restrictBackgroundStatus) {
          android.net.ConnectivityManager.RESTRICT_BACKGROUND_STATUS_ENABLED -> "enabled"
          android.net.ConnectivityManager.RESTRICT_BACKGROUND_STATUS_WHITELISTED -> "whitelisted"
          android.net.ConnectivityManager.RESTRICT_BACKGROUND_STATUS_DISABLED -> "disabled"
          else -> null
        }
      }.getOrNull()
      val bucket: Int? = if (sdk >= android.os.Build.VERSION_CODES.P) runCatching { usm?.appStandbyBucket }.getOrNull() else null
      mapOf("backgroundRestricted" to restricted, "dataSaver" to dataSaver, "standbyBucket" to bucket)
    }

    /** Is "Usage access" turned on for Bond right now? */
    Function("hasUsageAccess") { UsageStatsReader.hasUsageAccess(context) }

    /**
     * Open Android's Usage access LIST (the person finds Bond there). Not
     * Bond's own page ("package:" link): on some phones a sideloaded app's own
     * page shows "Restricted setting" while the same switch in the list works.
     */
    Function("openUsageAccessSettings") {
      val ctx = context
      val list = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        ctx.startActivity(list)
      } catch (_: Exception) {
        ctx.startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
    }

    /**
     * Usage between two times (ms since 1970). Rejects if Usage access is off,
     * so JavaScript can never mistake "no permission" for "no screen time".
     */
    AsyncFunction("getUsage") { startMs: Double, endMs: Double ->
      val ctx = context
      if (!UsageStatsReader.hasUsageAccess(ctx)) {
        throw Exceptions.MissingPermissions("Usage access")
      }
      val r = UsageStatsReader.getUsage(ctx, startMs.toLong(), endMs.toLong())
      mapOf(
        "totalMs" to r.totalMs.toDouble(),
        "launches" to r.launches,
        "apps" to r.apps.map {
          mapOf(
            "packageName" to it.packageName,
            "appName" to it.appName,
            "foregroundMs" to it.foregroundMs.toDouble(),
            "launches" to it.launches,
            "lastUsedMs" to it.lastUsedMs.toDouble(),
          )
        },
        "hourly" to r.hourly.map { mapOf("startMs" to it.startMs.toDouble(), "ms" to it.ms.toDouble()) },
      )
    }

    /**
     * Real launcher icons for the given apps, as file:// URIs of cached PNGs
     * (null for an app with no icon or that is not installed on this phone).
     * Needs no permission; only reads the icons of apps Bond can already see.
     */
    AsyncFunction("getAppIcons") { packages: List<String>, sizePx: Int ->
      val ctx = context
      val size = sizePx.coerceIn(24, 256)
      packages.distinct().take(100).associateWith { pkg ->
        UsageStatsReader.iconFile(ctx, pkg, size)?.let { Uri.fromFile(it).toString() }
      }
    }
  }
}
