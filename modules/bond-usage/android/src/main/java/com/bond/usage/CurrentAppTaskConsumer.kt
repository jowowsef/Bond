package com.bond.usage

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import expo.modules.interfaces.taskManager.TaskConsumer
import expo.modules.interfaces.taskManager.TaskConsumerInterface
import expo.modules.interfaces.taskManager.TaskInterface
import expo.modules.interfaces.taskManager.TaskManagerUtilsInterface

/**
 * Connects the "Currently Using" service to expo-task-manager, the same way
 * expo-location connects its background location service:
 *  - JavaScript registers a task with this consumer (BondUsage.startCurrentAppService)
 *    only when every rule holds; registering starts the foreground service,
 *    unregistering stops it;
 *  - each report from the service runs the JavaScript task
 *    (TaskManager.defineTask in src/lib/currentAppService.ts), which checks
 *    every rule again and uploads. expo-task-manager starts JavaScript without
 *    a screen if Bond's UI isn't running, and keeps its timers alive meanwhile;
 *  - expo-task-manager remembers the registration and restores it when Bond
 *    starts. Android doesn't allow starting a foreground service while an app
 *    is in the background, so a restore at such a moment just waits until
 *    Bond is opened.
 */
class CurrentAppTaskConsumer(context: Context, taskManagerUtils: TaskManagerUtilsInterface?) :
  TaskConsumer(context, taskManagerUtils), TaskConsumerInterface {

  private var task: TaskInterface? = null

  override fun taskType(): String = "bond-current-app"

  override fun didRegister(task: TaskInterface) {
    this.task = task
    active = this
    startService(task.options)
  }

  override fun didUnregister() {
    if (active === this) active = null
    task = null
    stopService()
  }

  override fun setOptions(options: Map<String, Any>) {
    super.setOptions(options)
    // Registered again from JavaScript (for example Bond opened): make sure the
    // service runs, with the current notification text.
    startService(options)
  }

  /**
   * Called by the service (main thread) with the latest observation.
   * `onDone(retry)` gets the JavaScript task's answer: retry = the upload
   * couldn't happen (for example offline), so send the latest app again later.
   */
  fun report(data: Bundle, onDone: (retry: Boolean) -> Unit) {
    val t = task ?: return onDone(false)
    try {
      t.execute(data, null) { response ->
        val result = response?.get("result") as? Map<*, *>
        onDone(result?.get("retry") == true)
      }
    } catch (e: Exception) {
      BackgroundDiagnostics.log(context, "report: JavaScript task could not run (${e.javaClass.simpleName})")
      onDone(true)
    }
  }

  private fun startService(options: Map<String, Any?>?) {
    val ctx = context ?: return
    val intent = Intent(ctx, CurrentAppService::class.java).apply {
      (options?.get("title") as? String)?.let { putExtra(CurrentAppService.EXTRA_TITLE, it) }
      (options?.get("body") as? String)?.let { putExtra(CurrentAppService.EXTRA_BODY, it) }
      putExtra(
        CurrentAppService.EXTRA_INTERVAL,
        (options?.get("intervalMs") as? Number)?.toLong() ?: CurrentAppService.DEFAULT_INTERVAL_MS,
      )
      putExtra(
        CurrentAppService.EXTRA_HEARTBEAT,
        (options?.get("heartbeatMs") as? Number)?.toLong() ?: CurrentAppService.DEFAULT_HEARTBEAT_MS,
      )
      putExtra(CurrentAppService.EXTRA_WATCH_APPS, (options?.get("watchApps") as? Boolean) ?: true)
      putExtra(CurrentAppService.EXTRA_WATCH_BATTERY, (options?.get("watchBattery") as? Boolean) ?: false)
      putExtra(CurrentAppService.EXTRA_WATCH_SCREEN_TIME, (options?.get("watchScreenTime") as? Boolean) ?: false)
    }
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(intent) else ctx.startService(intent)
    } catch (e: Exception) {
      // For example ForegroundServiceStartNotAllowedException while Bond is in
      // the background. It starts when Bond is opened again.
      BackgroundDiagnostics.log(ctx, "service: not started now (${e.javaClass.simpleName}); starts when Bond is opened")
    }
  }

  private fun stopService() {
    val ctx = context ?: return
    ctx.stopService(Intent(ctx, CurrentAppService::class.java))
  }

  companion object {

    /** The registered consumer the service reports to (null = not registered). */
    @Volatile
    var active: CurrentAppTaskConsumer? = null
      private set
  }
}
