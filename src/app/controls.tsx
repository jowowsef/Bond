import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { Alert, Modal, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { BackButton } from '@/components/HeaderBar';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useWebProtection } from '@/hooks/useWebProtection';
import { formatTime, timeAgo } from '@/lib/format';
import { openAppSettings } from '@/lib/setupPermissions';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';
import {
  openNetworkSettings,
  openVpnSettings,
  readPartnerWebStatus,
  shareWebStatus,
  turnOffWebProtection,
  turnOnWebProtection,
  type PartnerWebStatus,
} from '@/lib/webProtection';
import { useCouple } from '@/state/couple';

/**
 * CONTROLS: Web Protection (adult websites) on THIS phone.
 *
 * Real filtering via a DNS-only local VPN (modules/bond-web). The switch
 * state always comes from Android, never from a saved guess. The partner
 * section only shows what their phone reported; nothing here can change
 * their phone.
 */
export default function Controls() {
  useThemeVersion();
  const { userId, partnerId, partnerProfile } = useCouple();
  const partnerName = partnerProfile?.display_name ?? 'Your partner';
  const { support, status, refresh } = useWebProtection(userId);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [explainOpen, setExplainOpen] = useState(false);
  const [showLimits, setShowLimits] = useState(false);
  const [partner, setPartner] = useState<PartnerWebStatus | undefined>(undefined);
  const [partnerError, setPartnerError] = useState(false);

  const loadPartner = useCallback(async () => {
    if (!partnerId) return;
    try {
      setPartner(await readPartnerWebStatus(partnerId));
      setPartnerError(false);
    } catch (e) {
      setPartnerError(true);
      throw e;
    }
  }, [partnerId]);

  useFocusEffect(
    useCallback(() => {
      void loadPartner().catch(() => undefined);
    }, [loadPartner]),
  );

  const { refreshing, onRefresh } = usePullToRefresh(async () => {
    refresh();
    await loadPartner();
  });

  async function run(work: () => Promise<void>) {
    if (busyRef.current) return; // no double taps
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await work();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const turnOn = () =>
    run(async () => {
      setExplainOpen(false);
      const r = await turnOnWebProtection();
      if (!r.ok) setError(r.message);
      const s = refresh();
      if (userId) await shareWebStatus(userId, s).catch(() => undefined);
    });

  const turnOff = () =>
    Alert.alert(
      'Turn off Web Protection?',
      `Adult websites won't be filtered on this phone anymore. ${partnerName} will see that it is off.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Turn off',
          style: 'destructive',
          onPress: () =>
            void run(async () => {
              const r = await turnOffWebProtection();
              if (!r.ok) setError(r.message);
              const s = refresh();
              if (userId) await shareWebStatus(userId, s).catch(() => undefined);
            }),
        },
      ],
    );

  // ---------- this phone ----------
  let badge: { label: string; tone: 'success' | 'warning' | 'neutral' };
  let body: string;
  let action: React.ReactNode = null;
  if (support !== 'ready' || !status) {
    badge = { label: 'Not available', tone: 'neutral' };
    body =
      support === 'unsupported'
        ? 'Web Protection works on Android phones only.'
        : 'This copy of Bond was installed before Web Protection was added. Install the newest version of Bond on this phone to use it.';
  } else if (status.running) {
    badge = { label: 'On', tone: 'success' };
    body = 'Adult websites are being filtered on this phone, in browsers and in most apps.';
    action = <Button label="Turn off" variant="secondary" onPress={turnOff} disabled={busy} style={styles.action} />;
  } else if (status.enabled) {
    badge = { label: 'Paused', tone: 'warning' };
    body =
      status.stopReason === 'revoked'
        ? 'Web Protection was turned off in Android settings, or another VPN app took over. Websites are not being filtered right now.'
        : 'Web Protection is set to on but is not running, so websites are not being filtered right now.';
    action = (
      <View style={styles.actionRow}>
        <Button label="Turn back on" onPress={turnOn} loading={busy} style={styles.flex} />
        <Button label="Turn off" variant="ghost" onPress={turnOff} disabled={busy} style={styles.flex} />
      </View>
    );
  } else {
    badge = { label: 'Off', tone: 'neutral' };
    body = 'Block adult websites on this phone with a filter that runs on the phone itself. You decide, and you can turn it off any time.';
    action = <Button label="Set up Web Protection" onPress={() => setExplainOpen(true)} loading={busy} style={styles.action} />;
  }

  return (
    <Screen
      title="Web Protection"
      right={<BackButton />}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
      }
    >
      <SectionHeader title="This phone" />
      <Card>
        <View style={styles.cardHeader}>
          <View style={styles.icon}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.primary} />
          </View>
          <Text style={styles.cardTitle}>Web Protection</Text>
          <StatusBadge label={badge.label} tone={badge.tone} dot={badge.tone === 'success'} />
        </View>
        <Text style={styles.body}>{body}</Text>

        {status?.privateDnsHost ? (
          <Warning
            text={`Private DNS is set to "${status.privateDnsHost}", so websites can skip Bond's filter. Set Private DNS to Automatic or Off in your network settings.`}
            actionLabel="Open network settings"
            onPress={openNetworkSettings}
          />
        ) : null}
        {status && status.otherVpnActive && !status.running ? (
          <Warning
            text="Another VPN is on. Android allows only one VPN at a time, so turning on Web Protection will disconnect it."
          />
        ) : null}

        {action}
        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}

        {status?.running ? (
          <>
            <Text style={styles.meta}>
              {status.listDomains > 0
                ? `Filter list: ${status.listDomains.toLocaleString()} sites, updated ${timeAgo(new Date(status.listUpdatedAt).toISOString())}, plus Cloudflare's family filter.`
                : "Filter list: built-in list plus Cloudflare's family filter. The full list downloads in the background."}
            </Text>
            <Pressable onPress={openVpnSettings} hitSlop={8} accessibilityRole="button">
              <Text style={styles.link}>Keep it on after restarts: turn on &quot;Always-on VPN&quot; for Bond</Text>
            </Pressable>
          </>
        ) : null}
      </Card>

      <Pressable
        style={styles.limitsToggle}
        onPress={() => setShowLimits((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: showLimits }}
      >
        <Text style={styles.limitsToggleText}>What Web Protection can and can&apos;t do</Text>
        <Ionicons name={showLimits ? 'chevron-up' : 'chevron-down'} size={16} color={colors.muted} />
      </Pressable>
      {showLimits ? (
        <Card style={{ gap: spacing.sm }}>
          <Bullet text="Filters adult websites in browsers and most apps on this phone." />
          <Bullet text="It can't promise to block every adult site. New sites appear all the time." />
          <Bullet text="Apps or browsers with their own secure DNS, Private DNS set to a provider, another VPN app, or typing a site's IP address can get around it." />
          <Bullet text="Bond keeps no browsing history and uploads nothing about the sites you visit. Only on or off is shared with your partner." />
          <Bullet text="Website names are checked against Bond's list and Cloudflare's family filter (1.1.1.3), the same way any DNS service sees them." />
        </Card>
      ) : null}

      <SectionHeader title={`${partnerName}'s phone`} />
      <Card style={{ gap: spacing.sm }}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Web Protection</Text>
          {partner === undefined ? (
            partnerError ? <StatusBadge label="Unknown" tone="neutral" /> : null
          ) : partner === null ? (
            <StatusBadge label="Not set up" tone="neutral" />
          ) : (
            <StatusBadge label={partner.running ? 'On' : 'Off'} tone={partner.running ? 'success' : 'neutral'} dot={partner.running} />
          )}
        </View>
        <Text style={styles.body}>
          {partnerError && partner === undefined
            ? `Couldn't load ${partnerName}'s status. Pull down to try again.`
            : partner
              ? `Last reported by ${partnerName}'s phone at ${formatTime(partner.updatedAt)}.`
              : partner === null
                ? `${partnerName} hasn't turned on Web Protection yet.`
                : 'Loading…'}
        </Text>
        <Text style={styles.hint}>
          Only {partnerName} can turn this on, on their own phone. Bond can&apos;t change their phone for you.
        </Text>
      </Card>

      <View style={styles.infoBox}>
        <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
        <View style={{ flex: 1, gap: spacing.sm }}>
          <Text style={styles.infoText}>
            Permissions are set on each phone. You can allow Bond&apos;s permissions only on this phone, and{' '}
            {partnerName} needs to allow them on their own phone. Bond cannot grant permissions remotely.
          </Text>
          <Pressable onPress={() => void openAppSettings()} hitSlop={8} accessibilityRole="button">
            <Text style={styles.link}>Open this phone&apos;s Bond settings</Text>
          </Pressable>
        </View>
      </View>

      <Modal visible={explainOpen} transparent animationType="fade" onRequestClose={() => setExplainOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet} accessibilityViewIsModal>
            <Text style={styles.sheetTitle}>Before you turn on Web Protection</Text>
            <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: spacing.sm }}>
              <Bullet text="Android will ask you to allow a VPN connection for Bond. A key icon shows while it's on." />
              <Bullet text="It runs only on this phone. Bond doesn't send your browsing anywhere: only website names are checked as your phone looks them up." />
              <Bullet text="Names are checked against Bond's adult-site list and Cloudflare's free family filter (1.1.1.3), which also blocks malware sites." />
              <Bullet text="No browsing history is kept or uploaded. Your partner only sees whether it's on or off." />
              <Bullet text="It can't guarantee every adult site is blocked, and some apps or settings can get around it." />
              <Bullet text="Android allows one VPN at a time, so this disconnects any other VPN app." />
              <Bullet text="You can turn it off any time, here or in Android settings." />
            </ScrollView>
            <View style={styles.actionRow}>
              <Button label="Cancel" variant="secondary" onPress={() => setExplainOpen(false)} style={styles.flex} />
              <Button label="Continue" onPress={turnOn} loading={busy} style={styles.flex} />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function Warning({ text, actionLabel, onPress }: { text: string; actionLabel?: string; onPress?: () => void }) {
  useThemeVersion();
  return (
    <View style={styles.warning}>
      <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
      <View style={{ flex: 1, gap: spacing.xs }}>
        <Text style={styles.warningText}>{text}</Text>
        {actionLabel && onPress ? (
          <Text style={styles.link} onPress={onPress} accessibilityRole="button">
            {actionLabel}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function Bullet({ text }: { text: string }) {
  useThemeVersion();
  return (
    <View style={styles.bullet}>
      <View style={styles.dot} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { ...font.h3, color: colors.text, flex: 1 },
  body: { ...font.small, color: colors.subtext, lineHeight: 19, marginTop: spacing.sm },
  hint: { ...font.small, color: colors.muted, lineHeight: 18 },
  meta: { ...font.small, color: colors.muted, lineHeight: 18, marginTop: spacing.md },
  link: { ...font.small, fontWeight: '700', color: colors.primary, marginTop: spacing.sm },
  action: { marginTop: spacing.lg },
  actionRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  flex: { flex: 1 },
  error: { ...font.small, color: colors.danger, lineHeight: 18, marginTop: spacing.md },
  warning: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  warningText: { ...font.small, color: colors.text, lineHeight: 19 },
  limitsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    marginTop: spacing.sm,
  },
  limitsToggleText: { ...font.small, fontWeight: '600', color: colors.subtext },
  bullet: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.muted, marginTop: 7 },
  bulletText: { ...font.small, color: colors.subtext, lineHeight: 19, flex: 1 },
  infoBox: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.xl,
  },
  infoText: { ...font.small, color: colors.subtext, lineHeight: 19 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 20, 30, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  sheet: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '90%',
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    padding: spacing.xl,
  },
  sheetTitle: { ...font.h2, color: colors.text, marginBottom: spacing.md },
}));
