import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { getBackgroundPermission, isBackgroundTrackingRunning, type BackgroundPermission } from '@/lib/backgroundLocation';
import { offerBackgroundLocation } from '@/lib/locationPermissionFlow';
import { openAppSettings } from '@/lib/setupPermissions';
import { colors, font, spacing, themedStyles, useThemeVersion } from '@/lib/theme';

/**
 * Status line under my location sharing switch (only while sharing is on).
 * It is not a switch: background sharing follows location sharing plus
 * Android's "Allow all the time". It always says what is really happening,
 * read fresh from Android, and offers the way to Settings when background
 * updates are unavailable.
 */
export function BackgroundLocationStatus({
  sharing,
  partnerName,
  quietWithoutPermission = false,
  style,
}: {
  sharing: boolean;
  partnerName: string;
  /** The screen already warns when location permission is off: don't repeat it. */
  quietWithoutPermission?: boolean;
  style?: object;
}) {
  useThemeVersion();
  const [permission, setPermission] = useState<BackgroundPermission | null>(null);
  const [running, setRunning] = useState(false);

  const read = useCallback(async () => {
    const [perm, isRunning] = await Promise.all([
      getBackgroundPermission().catch(() => null),
      isBackgroundTrackingRunning(),
    ]);
    setPermission(perm);
    setRunning(isRunning);
  }, []);

  useEffect(() => {
    if (!sharing) return;
    void read();
    // The service is started by the main app right after a change; look again shortly.
    const t = setTimeout(() => void read(), 2500);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        void read();
        setTimeout(() => void read(), 2500);
      }
    });
    return () => {
      clearTimeout(t);
      sub.remove();
    };
  }, [sharing, read]);

  if (!sharing || permission === null) return null;
  if (permission === 'no-foreground' && quietWithoutPermission) return null;

  let icon: React.ComponentProps<typeof Ionicons>['name'] = 'moon-outline';
  let text: string;
  let action: { label: string; onPress: () => void } | null = null;
  let warn = false;

  if (permission === 'granted') {
    // Running normally: nothing to say here (Android's own notification shows it).
    if (running) return null;
    text = 'Android allows sharing while Bond is closed; it starts in a moment.';
  } else if (permission === 'no-foreground') {
    icon = 'alert-circle-outline';
    warn = true;
    text = 'Paused: Android location permission for Bond is off, so nothing is shared.';
    action = { label: 'Open settings', onPress: () => void openAppSettings() };
  } else {
    icon = 'alert-circle-outline';
    warn = true;
    text =
      'Only while Bond is open. Set location to "Allow all the time" for updates when closed.';
    action = {
      label: 'Allow all the time',
      onPress: () => void offerBackgroundLocation(partnerName).then(() => read()),
    };
  }

  return (
    <View style={[styles.row, style]}>
      <Ionicons name={icon} size={18} color={warn ? colors.warning : colors.primary} style={styles.icon} />
      <View style={styles.text}>
        <Text style={styles.sub}>{text}</Text>
        {action ? (
          <Pressable onPress={action.onPress} hitSlop={8} accessibilityRole="button">
            <Text style={styles.link}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = themedStyles(() => ({
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: spacing.md },
  icon: { marginRight: spacing.md, marginTop: 1 },
  text: { flex: 1 },
  sub: { ...font.small, color: colors.subtext, lineHeight: 18 },
  link: { ...font.small, fontWeight: '700', color: colors.primary, marginTop: spacing.xs },
}));
