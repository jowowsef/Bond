import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Image, Linking, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StackHeader } from '@/components/HeaderBar';
import { AccountProtection } from '@/components/AccountProtection';
import { BackgroundLocationStatus } from '@/components/BackgroundLocationStatus';
import { DeleteAccountModal } from '@/components/DeleteAccountModal';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { SectionHeader } from '@/components/SectionHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { ThemePicker } from '@/components/ThemePicker';
import { UnpairConfirmModal } from '@/components/UnpairConfirmModal';
import { AVATAR_CHOICES, type AvatarColor } from '@/lib/avatar';
import { reconcileBackgroundService } from '@/lib/backgroundService';
import { disableBatterySharing, enableBatterySharing } from '@/lib/battery';
import { currentAppStatusText, useCurrentAppSharing, type CurrentAppStatus } from '@/hooks/useCurrentAppSharing';
import { useLocationSharingSwitch } from '@/hooks/useLocationSharingSwitch';
import { askConfirm, confirmSharing, confirmStopSharing } from '@/lib/consent';
import { possessive, shownName } from '@/lib/format';
import { openLegalPage } from '@/lib/legalLinks';
import { requestLiveMode, useLiveStatus } from '@/lib/liveMode';
import { updateDisplayName } from '@/lib/pairing';
import { removeAvatarPhoto, uploadAvatarPhoto } from '@/lib/profilePhoto';
import { requestApproval } from '@/lib/requests';
import { getUsageSupport, hasUsageAccess } from '@/lib/screenTime';
import { readCalendarReminders, setCalendarReminders } from '@/lib/calendar';
import { readDailySummary, setDailySummary } from '@/lib/dailySummary';
import { requestNotifications } from '@/lib/setupPermissions';
import { supabase } from '@/lib/supabase';
import { requestUsageAccess } from '@/lib/usageAccessFlow';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';
import type { PrivacySettings } from '@/lib/types';
import { useCouple } from '@/state/couple';

/**
 * SETTINGS (opened from the gear in each tab's header).
 *
 * Real actions: edit name, copy code, privacy visibility toggles, and the
 * approval-based unpair. Every sharing switch (including location) is the
 * person's own choice and takes effect immediately.
 *
 * Also opened from Show Code / Enter Code while NOT paired: then it shows
 * only what applies without a partner (profile, account, appearance, device
 * permissions, about, log out). No partner information, sharing switches or
 * unpair controls are shown, and nothing assumes a couple exists.
 */
export default function Settings() {
  useThemeVersion();
  const router = useRouter();
  const { phase, session, myProfile, partnerProfile, couple, userId, refresh, outgoingRequests, resetSession, pairingSetup } = useCouple();
  const paired = phase === 'paired';
  // Email / Google accounts can sign in again; an anonymous one could not, so
  // it gets no Log out (that would lose the account).
  const canLogOut = !!session && !session.user.is_anonymous;
  const appVersion = Constants.expoConfig?.version ?? null;
  // Hidden: tap Version 7 times to open the background diagnostics (testing).
  const versionTaps = useRef({ count: 0, at: 0 });
  const onVersionTap = () => {
    const now = Date.now();
    const t = versionTaps.current;
    t.count = now - t.at < 1500 ? t.count + 1 : 1;
    t.at = now;
    if (t.count >= 7) {
      t.count = 0;
      router.push('/background-diagnostics');
    }
  };
  const [loggingOut, setLoggingOut] = useState(false);
  // My own calendar reminders preference (null = not available yet: 0012 not applied).
  const [calReminders, setCalReminders] = useState<boolean | null>(null);
  useEffect(() => {
    if (!userId || phase !== 'paired') return;
    void readCalendarReminders(userId).then(setCalReminders);
  }, [userId, phase]);
  // Optional daily summary of my partner's screen time (on this phone only).
  const [dailySummary, setDailySummaryState] = useState<boolean | null>(null);
  useEffect(() => {
    if (!userId || phase !== 'paired') return;
    void readDailySummary(userId).then(setDailySummaryState);
  }, [userId, phase]);
  async function onDailySummary(next: boolean) {
    if (!userId) return;
    if (next && (await requestNotifications()) !== 'granted') {
      Alert.alert('Notifications are off', 'Allow notifications for Bond to get a daily summary.');
      return;
    }
    setDailySummaryState(next);
    await setDailySummary(userId, next);
  }
  async function onCalendarReminders(next: boolean) {
    if (!userId) return;
    setCalReminders(next);
    if (!(await setCalendarReminders(userId, next))) {
      setCalReminders(!next);
      Alert.alert('Not saved', 'Could not change this. Check your connection and try again.');
    }
  }

  const [name, setName] = useState(myProfile?.display_name ?? '');
  const [privacy, setPrivacy] = useState<PrivacySettings | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [saved, setSaved] = useState(false);
  // Photo adjustment modal: a picked+cropped image waiting for Save/Cancel.
  const [pendingPhoto, setPendingPhoto] = useState<{ uri: string; base64: string } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [unpairOpen, setUnpairOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Low battery alerts need notifications allowed on THIS phone (read, never requested here).
  const [notificationsOn, setNotificationsOn] = useState<boolean | null>(null);
  // Android's Usage access, read fresh (also when coming back from Android Settings).
  const [usageAccess, setUsageAccess] = useState(() => hasUsageAccess());
  useEffect(() => {
    const check = () => {
      setUsageAccess(hasUsageAccess());
      void Notifications.getPermissionsAsync()
        .then((p) => setNotificationsOn(p.granted))
        .catch(() => setNotificationsOn(null));
    };
    check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => sub.remove();
  }, []);

  const nameChanged = name.trim().length > 0 && name.trim() !== (myProfile?.display_name ?? '');
  const hasPhoto = !!myProfile?.avatar_path;

  useEffect(() => {
    if (myProfile?.display_name) setName(myProfile.display_name);
  }, [myProfile?.display_name]);

  const loadPrivacy = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase.from('privacy_settings').select('*').eq('user_id', userId).maybeSingle();
    if (data) setPrivacy(data as PrivacySettings);
  }, [userId]);

  useEffect(() => {
    void loadPrivacy();
  }, [loadPrivacy]);

  const unpairPending = outgoingRequests.some((r) => r.action === 'unpair');

  async function saveName() {
    if (!userId) return;
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed === myProfile?.display_name) return;
    setSavingName(true);
    const result = await updateDisplayName(userId, trimmed);
    if (!result.ok) {
      setSavingName(false);
      Alert.alert('Could not save name', result.message ?? 'Please try again.');
      return;
    }
    await refresh();
    setSavingName(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  async function onPickPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo access to choose a profile picture.');
      return;
    }
    // The built-in editor gives pan/zoom + a fixed 1:1 crop (no extra deps).
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6,
      base64: true,
    });
    if (result.canceled || !result.assets[0]?.base64) return;
    // Hold it for the Save/Cancel preview — don't replace the avatar yet.
    setPendingPhoto({ uri: result.assets[0].uri, base64: result.assets[0].base64 });
  }

  async function onSavePhoto() {
    if (!pendingPhoto || !userId) return;
    setPhotoBusy(true);
    const result = await uploadAvatarPhoto(userId, pendingPhoto.base64);
    setPhotoBusy(false);
    if (!result.ok) {
      Alert.alert('Could not save photo', result.message);
      return;
    }
    setPendingPhoto(null);
    await refresh();
  }

  async function onRemovePhoto() {
    if (!userId) return;
    const result = await removeAvatarPhoto(userId, myProfile?.avatar_path ?? null);
    if (!result.ok) {
      Alert.alert('Could not remove photo', result.message);
      return;
    }
    await refresh();
  }

  async function onPickColor(color: AvatarColor) {
    if (!userId || myProfile?.avatar_color === color) return;
    // Changing colour never touches the photo.
    await supabase.from('profiles').update({ avatar_color: color }).eq('id', userId);
    await refresh();
  }

  async function onToggleBattery(next: boolean) {
    if (!userId) return;
    if (next && !(await confirmSharing('battery', partnerName))) return;
    if (!next && !(await confirmStopSharing('battery', partnerName))) return; // Cancel: nothing changes
    setPrivacy((p) => (p ? { ...p, share_battery: next } : p));
    const result = next ? await enableBatterySharing(userId) : await disableBatterySharing(userId);
    if (!result.ok) {
      Alert.alert('Could not update', result.message ?? 'Please try again.');
      await loadPrivacy();
    }
    // Start / stop the battery part of the background service to match.
    if (phase === 'paired' && pairingSetup === 'done') await reconcileBackgroundService(userId, partnerName).catch(() => null);
  }

  async function setVisibility(
    field: 'share_screen_time' | 'share_battery',
    value: boolean,
  ): Promise<boolean> {
    if (!userId) return false;
    setPrivacy((p) => (p ? { ...p, [field]: value } : p));
    const { error } = await supabase.from('privacy_settings').update({ [field]: value }).eq('user_id', userId);
    if (error) {
      // Show the real (saved) state again instead of a switch that lies.
      setPrivacy((p) => (p ? { ...p, [field]: !value } : p));
      Alert.alert('Not saved', 'Could not save this setting. Check your connection and try again.');
      return false;
    }
    return true;
  }

  function onUnpair() {
    if (unpairPending) return;
    setUnpairOpen(true);
  }

  /** Sends the unpair request; the modal shows loading / errors / success. */
  async function sendUnpairRequest(): Promise<{ ok: boolean; message?: string }> {
    const result = await requestApproval('unpair');
    if (!result.ok) return { ok: false, message: result.message };
    await refresh(); // shows "Unpair request pending" right away
    return { ok: true };
  }

  const partnerName = shownName(partnerProfile?.display_name, 'Your partner');
  // "Denize's" (or "your partner's" when the name isn't known yet).
  const knownPartner = partnerProfile?.display_name?.trim();
  const batteryAlertName = knownPartner && knownPartner !== 'Me' ? possessive(knownPartner) : "your partner's";
  const locationOn = !!privacy?.share_location;
  const currentApp = useCurrentAppSharing(paired ? userId : null, partnerName);
  const live = useLiveStatus();

  async function onLogOut() {
    if (loggingOut) return;
    const ok = await askConfirm(
      'Log out?',
      'You can sign in again anytime with the same email or Google account. Your account and its data stay as they are.',
      'Log out',
      'Cancel',
    );
    if (!ok) return;
    setLoggingOut(true);
    await resetSession(); // this phone only; also stops background location
    setLoggingOut(false);
    if (router.canDismiss()) router.dismissAll();
    router.replace('/welcome');
  }
  // Own switch only, no partner approval. Same logic as the Location tab.
  const locationSwitch = useLocationSharingSwitch({
    userId,
    partnerName,
    onChanged: () => Promise.all([loadPrivacy(), refresh()]),
  });

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <StackHeader title="Settings" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Profile */}
        <SectionHeader title="Profile" />
        <Card>
          <View style={styles.avatarPreview}>
            <ProfileAvatar profile={myProfile} who="me" size={84} />
          </View>

          <Text style={styles.fieldLabel}>Display name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Display name"
            placeholderTextColor={colors.muted}
            style={styles.nameInput}
            maxLength={30}
            returnKeyType="done"
            onSubmitEditing={saveName}
          />
          {nameChanged ? (
            <Button label={saved ? 'Saved' : 'Save'} small onPress={saveName} loading={savingName} style={styles.saveBtn} />
          ) : null}

          <View style={styles.sectionDivider} />

          <Text style={styles.fieldLabel}>Avatar color</Text>
          <View style={styles.colorRow}>
            {AVATAR_CHOICES.map((choice) => {
              const isSel = myProfile?.avatar_color === choice.key;
              return (
                <Pressable
                  key={choice.key}
                  onPress={() => onPickColor(choice.key)}
                  style={[styles.colorChip, isSel && styles.colorChipSelected]}
                >
                  <View style={[styles.swatch, { backgroundColor: choice.color }]}>
                    {isSel ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
                  </View>
                  <Text style={styles.colorLabel}>{choice.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.profileHint}>
            {hasPhoto ? 'Shown when no photo is set.' : 'Used for your avatar until you add a photo.'}
          </Text>

          <View style={styles.sectionDivider} />

          <Text style={styles.fieldLabel}>Profile photo</Text>
          <View style={styles.photoButtons}>
            <Button
              label={hasPhoto ? 'Change photo' : 'Add photo'}
              variant="secondary"
              small
              icon="image-outline"
              onPress={onPickPhoto}
            />
            {hasPhoto ? (
              <Button label="Remove photo" variant="ghost" small onPress={onRemovePhoto} />
            ) : null}
          </View>
        </Card>

        {/* Account protection: link an email + password to THIS account */}
        <SectionHeader title="Account" />
        {userId ? <AccountProtection userId={userId} /> : null}

        {/* Appearance: light / dark / follow the phone */}
        <SectionHeader title="Appearance" />
        <ThemePicker />

        {paired ? (
          <>
        {/* Couple */}
        <SectionHeader title="Couple" />
        <Card>
          <Row icon="heart-outline" label="Partner" value={shownName(partnerProfile?.display_name, 'Still setting up')} last />
        </Card>

        {/* Currently Using: its own section, easy to find */}
        <SectionHeader title="Currently Using" />
        <Card>
          <SwitchRow
            icon="phone-portrait-outline"
            label="Share the app I'm using"
            sub={`${partnerName} sees the name of the app open on your phone and when it was last checked. Only the latest app, never a history, and nothing inside apps.`}
            value={currentApp.switchValue}
            disabled={currentApp.switchDisabled}
            onChange={currentApp.toggle}
          />
          <InfoRow
            icon={currentApp.status === 'needs-access' ? 'alert-circle-outline' : 'pulse-outline'}
            label="Status"
            sub={currentAppStatusText(currentApp.status, partnerName, currentApp.ready)}
            right={<CurrentAppBadge status={currentApp.status} busy={currentApp.busy} />}
            last={currentApp.status !== 'needs-access' && !(currentApp.notificationsOff && currentApp.switchValue)}
          />
          {currentApp.status === 'needs-access' ? (
            <View style={[styles.actionRow, !(currentApp.notificationsOff && currentApp.switchValue) ? null : styles.divider]}>
              <View style={styles.photoButtons}>
                <Button label="Open Usage access settings" small onPress={currentApp.openAccessSettings} />
                {/* The switch shows OFF while blocked; this ends the saved choice too. */}
                <Button label="Turn off sharing" small variant="ghost" onPress={() => currentApp.toggle(false)} />
              </View>
            </View>
          ) : null}
          {currentApp.notificationsOff && currentApp.switchValue ? (
            <View style={styles.actionRow}>
              <Text style={styles.rowSub}>
                Notifications are off for Bond, so Android hides the sharing notification. Sharing still works.
              </Text>
              <Button label="Allow notifications" small variant="secondary" onPress={currentApp.allowNotifications} style={{ marginTop: spacing.sm }} />
            </View>
          ) : null}
        </Card>
        {/* Optional Live mode (Android Accessibility): faster Currently Using. */}
        {live.status !== 'unavailable' ? (
          <Card style={{ marginTop: spacing.sm }}>
            <Pressable
              onPress={() => void requestLiveMode(partnerName)}
              disabled={live.status === 'on'}
              accessibilityRole="button"
              accessibilityLabel={`Live app detection, optional: ${live.status === 'on' ? 'on' : live.status === 'closed' ? 'closed by the phone' : 'off'}`}
            >
              <InfoRow
                icon="flash-outline"
                label="Live app detection (optional)"
                sub={
                  live.status === 'on'
                    ? currentApp.switchValue
                      ? `On. ${partnerName} sees the app you switch to within a second or two. Turn it off anytime in Android Settings › Accessibility.`
                      : 'On, but nothing is shared while "Share the app I’m using" is off.'
                    : live.status === 'closed'
                      ? 'Accessibility is on, but your phone closed it. Tap to see how to bring it back.'
                      : `Off. Tap to turn on Accessibility, so ${partnerName} sees the app you switch to right away instead of minutes later. Only the app’s name, never what’s on your screen.`
                }
                right={
                  <StatusBadge
                    label={live.status === 'on' ? 'On' : live.status === 'closed' ? 'Closed' : 'Off'}
                    tone={live.status === 'on' ? 'success' : live.status === 'closed' ? 'warning' : 'neutral'}
                    dot={live.status === 'on'}
                  />
                }
                last
              />
            </Pressable>
          </Card>
        ) : null}
        {currentApp.error ? (
          <Text style={[styles.note, { color: colors.danger }]}>
            {currentApp.error}{' '}
            <Text style={{ fontWeight: '700', color: colors.primary }} onPress={currentApp.retry}>
              Try again
            </Text>
          </Text>
        ) : null}

        {/* Calendar reminders (each person decides for themselves) */}
        {calReminders !== null ? (
          <>
            <SectionHeader title="Calendar" />
            <Card>
              <SwitchRow
                icon="calendar-outline"
                label="Calendar reminders"
                sub={calReminders ? 'Notifications for shared events that have a reminder' : 'Off: no reminders on this account'}
                value={calReminders}
                onChange={(v) => void onCalendarReminders(v)}
                last
              />
            </Card>
          </>
        ) : null}

        {/* Daily summary (optional, this phone only) */}
        {paired && dailySummary !== null ? (
          <>
            <SectionHeader title="Daily summary" />
            <Card>
              <SwitchRow
                icon="moon-outline"
                label={`${possessive(partnerName)} day`}
                sub={
                  dailySummary
                    ? `One notification at about 9 PM with ${possessive(partnerName)} screen time and top app today (only if ${partnerName} shares screen time).`
                    : `Off. Turn on for one notification each evening, never one per app.`
                }
                value={dailySummary}
                onChange={(v) => void onDailySummary(v)}
                last
              />
            </Card>
          </>
        ) : null}

        {/* Privacy */}
        <SectionHeader title="Privacy" />
        <Card>
          <SwitchRow
            icon="location-outline"
            label="Location sharing"
            sub={locationOn ? `${partnerName} can see your location` : 'Off'}
            value={locationSwitch.pending ?? locationOn}
            disabled={locationSwitch.busy}
            onChange={locationSwitch.request}
          />
          <BackgroundLocationStatus sharing={locationOn} partnerName={partnerName} style={styles.divider} />
          <SwitchRow
            icon="battery-half-outline"
            label="Battery sharing"
            sub={privacy?.share_battery ? 'On. Sent in the background (quiet notification).' : 'Off'}
            value={privacy?.share_battery ?? false}
            onChange={onToggleBattery}
          />
          {/* Automatic for paired couples (no switch). Needs notifications on THIS phone. */}
          <InfoRow
            icon="notifications-outline"
            label="Low battery alerts"
            sub={`Get notified when ${batteryAlertName} battery is low.`}
            right={
              notificationsOn === null ? null : notificationsOn ? (
                <StatusBadge label="On" tone="success" dot />
              ) : (
                <Pressable
                  onPress={() => void Linking.openSettings()}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Notifications are off. Open settings to allow them."
                >
                  <StatusBadge label="Notifications off" tone="warning" />
                </Pressable>
              )
            }
          />
          <SwitchRow
            icon="time-outline"
            label="Screen-time visibility"
            sub={
              privacy?.share_screen_time && getUsageSupport() === 'ready' && !usageAccess
                ? 'On, but Usage access is off on this phone, so nothing is sent'
                : undefined
            }
            value={privacy?.share_screen_time ?? false}
            onChange={(v) =>
              void (async () => {
                if (v && !(await confirmSharing('screen_time', partnerName))) return;
                if (!v && !(await confirmStopSharing('screen_time', partnerName))) return;
                await setVisibility('share_screen_time', v);
                // Start / stop the screen time part of the background service to match.
                if (phase === 'paired' && pairingSetup === 'done') await reconcileBackgroundService(userId, partnerName).catch(() => null);
              })()
            }
            last
          />
        </Card>
        {privacy?.share_screen_time && getUsageSupport() === 'ready' && !usageAccess ? (
          <Text
            style={[styles.note, { color: colors.warning }]}
            onPress={() => void requestUsageAccess('Screen time can only be sent once Android allows Bond to read app usage.')}
          >
            Turn on Usage access so your screen time can be sent.
          </Text>
        ) : null}
        <Text style={styles.note}>
          Visibility controls what {partnerName} can see. You can turn any of these on or off yourself at any time.
        </Text>

          </>
        ) : (
          <>
            <SectionHeader title="Sharing & permissions" />
            <Card>
              <InfoRow
                icon="lock-closed-outline"
                label="No partner connected"
                sub="Nothing is shared while you are not paired. After you pair, Bond asks again before anything is shared."
                last
              />
            </Card>
          </>
        )}

        {/* Permissions: one entry for everything Android needs to allow
            (notifications, location, Usage access, background battery use). */}
        <SectionHeader title="Permissions" />
        <Card>
          <Pressable onPress={() => router.push({ pathname: '/optional-setup', params: { from: 'settings' } })} accessibilityRole="button">
            <Row icon="shield-checkmark-outline" label="Device permissions" chevron last />
          </Pressable>
        </Card>

        {paired ? (
          <>
        {/* Danger zone */}
        <SectionHeader title="Pairing" />
        <Card>
          <Pressable onPress={onUnpair} disabled={unpairPending}>
            <Row
              icon="unlink-outline"
              label={unpairPending ? 'Unpair request pending' : 'Unpair'}
              danger
              right={unpairPending ? <StatusBadge label="Pending" tone="warning" /> : undefined}
              chevron={!unpairPending}
              last
            />
          </Pressable>
        </Card>
        <Text style={styles.note}>
          Unpairing needs both partners to agree — one person can't disconnect the couple on their own.
        </Text>
          </>
        ) : null}

        {/* Legal + data */}
        <SectionHeader title="About Bond & your data" />
        <Card>
          {appVersion ? (
            <Pressable onPress={onVersionTap}>
              <Row icon="information-circle-outline" label="Version" value={appVersion} />
            </Pressable>
          ) : null}
          <Pressable onPress={() => void openLegalPage('privacy')} accessibilityRole="link">
            <Row icon="document-text-outline" label="Privacy Policy" chevron />
          </Pressable>
          <Pressable onPress={() => void openLegalPage('terms')} accessibilityRole="link">
            <Row icon="reader-outline" label="Terms of Use" chevron />
          </Pressable>
          <Pressable onPress={() => setDeleteOpen(true)} accessibilityRole="button">
            <Row icon="trash-outline" label="Delete account" danger chevron last />
          </Pressable>
        </Card>
        <Text style={styles.note}>
          {paired ? `${partnerName} only sees what your Privacy switches allow. ` : ''}Deleting your account permanently
          removes your data from Bond.
        </Text>

        {canLogOut ? (
          <>
            <SectionHeader title="Log out" />
            <Card>
              <Pressable onPress={() => void onLogOut()} disabled={loggingOut} accessibilityRole="button">
                <Row icon="log-out-outline" label={loggingOut ? 'Logging out…' : 'Log out'} last />
              </Pressable>
            </Card>
            <Text style={styles.note}>Logging out keeps your account. Sign in again with the same email or Google account.</Text>
          </>
        ) : null}

        <View style={{ height: spacing.xxl }} />
      </ScrollView>

      {/* Photo adjust: preview inside the fixed avatar frame, then Save/Cancel.
          The crop/pan/zoom already happened in the picker's editor; the avatar
          never changes until Save is pressed. */}
      <Modal visible={!!pendingPhoto} transparent animationType="fade" onRequestClose={() => setPendingPhoto(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Use this photo?</Text>
            <Text style={styles.modalSub}>This is how your avatar will look.</Text>
            <View style={styles.modalFrame}>
              {pendingPhoto ? <Image source={{ uri: pendingPhoto.uri }} style={styles.modalImage} /> : null}
            </View>
            <View style={styles.modalActions}>
              <Button label="Cancel" variant="secondary" onPress={() => setPendingPhoto(null)} style={styles.modalBtn} />
              <Button label="Save" onPress={onSavePhoto} loading={photoBusy} style={styles.modalBtn} />
            </View>
          </View>
        </View>
      </Modal>

      {userId ? (
        <DeleteAccountModal
          visible={deleteOpen}
          userId={userId}
          partnerName={partnerName}
          paired={!!partnerProfile}
          onClose={() => setDeleteOpen(false)}
        />
      ) : null}
      <UnpairConfirmModal
        visible={unpairOpen}
        mode="request"
        partnerName={partnerName}
        onCancel={() => setUnpairOpen(false)}
        onConfirm={sendUnpairRequest}
        onFinished={() => setUnpairOpen(false)}
      />
    </SafeAreaView>
  );
}

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** Truthful service / sharing state for the Currently Using section. */
function CurrentAppBadge({ status, busy }: { status: CurrentAppStatus; busy: boolean }) {
  useThemeVersion();
  if (busy || status === 'loading') return <StatusBadge label="…" tone="neutral" />;
  switch (status) {
    case 'running':
      return <StatusBadge label="Running" tone="success" dot />;
    case 'starting':
      return <StatusBadge label="Starting" tone="warning" />;
    case 'open-only':
      return <StatusBadge label="Limited" tone="warning" />;
    case 'needs-access':
      return <StatusBadge label="Needs permission" tone="warning" />;
    case 'off':
      return <StatusBadge label="Off" tone="neutral" />;
    case 'error':
      return <StatusBadge label="Error" tone="warning" />;
    default:
      return <StatusBadge label="Unavailable" tone="neutral" />;
  }
}

function Row({
  icon,
  label,
  value,
  right,
  danger,
  chevron,
  last,
}: {
  icon: IconName;
  label: string;
  value?: string;
  right?: React.ReactNode;
  danger?: boolean;
  chevron?: boolean;
  last?: boolean;
}) {
  useThemeVersion();
  const color = danger ? colors.danger : colors.text;
  return (
    <View style={[styles.row, !last && styles.divider]}>
      <Ionicons name={icon} size={18} color={danger ? colors.danger : colors.primary} style={styles.rowIcon} />
      <Text style={[styles.rowLabel, { color }]}>{label}</Text>
      <View style={styles.rowRight}>
        {value ? <Text style={styles.rowValue}>{value}</Text> : null}
        {right}
        {chevron ? <Ionicons name="chevron-forward" size={18} color={colors.muted} /> : null}
      </View>
    </View>
  );
}

/** A settings row with a description and optional status on the right (no switch). */
function InfoRow({
  icon,
  label,
  sub,
  right,
  last,
}: {
  icon: IconName;
  label: string;
  sub?: string;
  right?: React.ReactNode;
  last?: boolean;
}) {
  useThemeVersion();
  return (
    <View style={[styles.row, !last && styles.divider]}>
      <Ionicons name={icon} size={18} color={colors.primary} style={styles.rowIcon} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, { color: colors.text }]}>{label}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      {right}
    </View>
  );
}

function SwitchRow({
  icon,
  label,
  sub,
  value,
  onChange,
  disabled,
  last,
}: {
  icon: IconName;
  label: string;
  sub?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  last?: boolean;
}) {
  useThemeVersion();
  return (
    <View style={[styles.row, !last && styles.divider]}>
      <Ionicons name={icon} size={18} color={colors.primary} style={styles.rowIcon} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, { color: colors.text }]}>{label}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: colors.primary, false: colors.border }}
        thumbColor="#fff"
      />
    </View>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: 0 },
  profileRow: { flexDirection: 'row', alignItems: 'center' },
  // Label sits close to its input, groups are separated by sectionDivider.
  fieldLabel: { ...font.small, color: colors.muted, marginBottom: 6 },
  nameInput: { ...font.h2, color: colors.text, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 6 },
  profileHint: { ...font.small, color: colors.muted, marginTop: spacing.sm },
  saveBtn: { alignSelf: 'flex-start', marginTop: spacing.lg, minWidth: 110 },
  avatarPreview: { alignItems: 'center', marginTop: spacing.xs, marginBottom: spacing.xl },
  // Standalone separator between profile groups (keeps them from crowding).
  sectionDivider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.lg },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.sm },
  colorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.border,
  },
  colorChipSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  swatch: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  colorLabel: { ...font.body, fontWeight: '600', color: colors.text },
  photoButtons: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(31,42,68,0.45)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  modalCard: { width: '100%', maxWidth: 340, backgroundColor: colors.card, borderRadius: radius.xl, padding: spacing.xl, alignItems: 'center' },
  modalTitle: { ...font.h2, color: colors.text },
  modalSub: { ...font.small, color: colors.subtext, marginTop: spacing.xs, marginBottom: spacing.lg },
  modalFrame: { width: 180, height: 180, borderRadius: 90, overflow: 'hidden', backgroundColor: colors.track },
  modalImage: { width: '100%', height: '100%' },
  modalActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl, alignSelf: 'stretch' },
  modalBtn: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowIcon: { marginRight: spacing.md, width: 22, textAlign: 'center' },
  rowLabel: { ...font.body, flex: 1 },
  rowSub: { ...font.small, color: colors.muted, marginTop: 2 },
  actionRow: { paddingVertical: spacing.md },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowValue: { ...font.body, color: colors.subtext },
  note: { ...font.small, color: colors.muted, marginTop: spacing.sm, marginHorizontal: spacing.xs, lineHeight: 18 },
}));
