package com.bond.nativebridge

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The gentle "this app is paused" screen shown when a blocked app is opened.
 * Built with plain Android views (no React Native) so it appears instantly.
 * It always tells the person HOW to remove the block — no lock-outs.
 */
class BlockedActivity : Activity() {

  companion object {
    const val EXTRA_APP_NAME = "app_name"
    const val EXTRA_PARTNER_NAME = "partner_name"
  }

  private fun dp(v: Int) = TypedValue.applyDimension(
    TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics
  ).toInt()

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val appName = intent.getStringExtra(EXTRA_APP_NAME) ?: "This app"
    val partner = intent.getStringExtra(EXTRA_PARTNER_NAME) ?: "your partner"

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setPadding(dp(32), dp(32), dp(32), dp(32))
      setBackgroundColor(Color.parseColor("#F7F7FD"))
    }

    fun text(value: String, sizeSp: Float, color: String, bold: Boolean = false) =
      TextView(this).apply {
        text = value
        textSize = sizeSp
        setTextColor(Color.parseColor(color))
        gravity = Gravity.CENTER
        if (bold) setTypeface(typeface, Typeface.BOLD)
        setPadding(0, dp(6), 0, dp(6))
      }

    fun button(label: String, filled: Boolean, onClick: () -> Unit) = Button(this).apply {
      text = label
      isAllCaps = false
      textSize = 16f
      setTextColor(Color.parseColor(if (filled) "#FFFFFF" else "#6C63FF"))
      background = GradientDrawable().apply {
        cornerRadius = dp(28).toFloat()
        if (filled) setColor(Color.parseColor("#6C63FF"))
        else { setColor(Color.WHITE); setStroke(dp(1), Color.parseColor("#D9D6FF")) }
      }
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT, dp(52)
      ).apply { topMargin = dp(12) }
      setOnClickListener { onClick() }
    }

    root.addView(text("🌙", 56f, "#000000"))
    root.addView(text("$appName is paused", 24f, "#1F1D36", bold = true))
    root.addView(text(
      "You and $partner agreed to take a break from $appName.\n\n" +
        "This is your phone — you can turn this off anytime in Bond → Controls → My phone.",
      15f, "#5B5A72"
    ))
    root.addView(button("Go to home screen", filled = true) { goHome() })
    root.addView(button("Open Bond", filled = false) {
      packageManager.getLaunchIntentForPackage(packageName)?.let {
        startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
      finish()
    })

    setContentView(root)
  }

  private fun goHome() {
    startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    finish()
  }

  @Deprecated("Back = go home, not back into the blocked app")
  override fun onBackPressed() {
    goHome()
  }
}
