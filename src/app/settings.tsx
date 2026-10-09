import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackHeader } from '@/components/BackHeader';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { SectionHeader } from '@/components/SectionHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { AVATAR_CHOICES, type AvatarColor } from '@/lib/avatar';
import { disableBatterySharing, enableBatterySharing } from '@/lib/battery';
import { enableLocationSharing } from '@/lib/location';
import { displayCode, updateDisplayName } from '@/lib/pairing';
import { removeAvatarPhoto, uploadAvatarPhoto } from '@/lib/profilePhoto';
import { requestApproval } from '@/lib/requests';
import { supabase } from '@/lib/supabase';
import { colors, font, radius, spacing } from '@/lib/theme';
import type { PrivacySettings } from '@/lib/types';
import { useCouple } from '@/state/couple';

/**
 * SETTINGS (opened from the gear in each tab's header).
 *
 * Real actions: edit name, copy code, privacy visibility toggles, and the
 * approval-based unpair. Turning location sharing OFF needs partner approval,
 * so that switch sends a request instead of flipping immediately.
 */
export default function Settings() {
  const router = useRouter();
  const { myProfile, partnerProfile, couple, userId, refresh, outgoingRequests } = useCouple();

  const [name, setName] = useState(myProfile?.display_name ?? '');
  const [copied, setCopied] = useState(false);
  const [privacy, setPrivacy] = useState<PrivacySettings | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [saved, setSaved] = useState(false);
  // Photo adjustment modal: a picked+cropped image waiting for Save/Cancel.
  const [pendingPhoto, setPendingPhoto] = useState<{ uri: string; base64: string } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

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
  const locationOffPending = outgoingRequests.some((r) => r.action === 'location_off');

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

  async function onCopy() {
    if (!couple) return;
    await Clipboard.setStringAsync(displayCode(couple.invite_code));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function onToggleBattery(next: boolean) {
    if (!userId) return;
    setPrivacy((p) => (p ? { ...p, share_battery: next } : p));
    const result = next ? await enableBatterySharing(userId) : await disableBatterySharing(userId);
    if (!result.ok) {
      Alert.alert('Could not update', result.message ?? 'Please try again.');
      await loadPrivacy();
    }
  }

  async function setVisibility(field: 'share_screen_time' | 'share_activity' | 'share_battery', value: boolean) {
    if (!userId) return;
    setPrivacy((p) => (p ? { ...p, [field]: value } : p));
    await supabase.from('privacy_settings').update({ [field]: value }).eq('user_id', userId);
  }

  async function onToggleLocation(next: boolean) {
    if (!userId) return;
    if (next) {
      // Turning ON is your own choice — grant the OS permission and start sharing.
      const result = await enableLocationSharing(userId);
      if (!result.ok) {
        Alert.alert('Location not enabled', result.message ?? 'Please try again.');
        return;
      }
      await loadPrivacy();
    } else {
      // Turning OFF is a shared change → ask the partner to approve.
      const result = await requestApproval('location_off');
      if (!result.ok) {
        Alert.alert('Could not send request', result.message);
        return;
      }
      Alert.alert('Request sent', `${partnerName} needs to approve turning your location sharing off.`);
    }
  }

  function onUnpair() {
    Alert.alert(
      'Request to unpair?',
      `Unpairing affects both of you. ${partnerName} will need to approve it before you're disconnected. You won't be unpaired on your own.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send request',
          style: 'destructive',
          onPress: async () => {
            const result = await requestApproval('unpair');
            if (!result.ok) {
              Alert.alert('Could not send request', result.message);
              return;
            }
            Alert.alert('Request sent', `${partnerName} needs to approve before you're unpaired.`);
          },
        },
      ],
    );
  }

  const partnerName = partnerProfile?.display_name ?? 'Your partner';
  const locationOn = !!privacy?.share_location;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <BackHeader title="Settings" />
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

        {/* Couple */}
        <SectionHeader title="Couple" />
        <Card>
          <Row icon="heart-outline" label="Partner" value={partnerProfile?.display_name ?? '—'} />
          <Pressable onPress={onCopy}>
            <Row
              icon="key-outline"
              label="Pairing code"
              value={displayCode(couple?.invite_code)}
              right={<StatusBadge label={copied ? 'Copied' : 'Copy'} tone="primary" />}
            />
          </Pressable>
          <Pressable onPress={() => router.push('/optional-setup')}>
            <Row icon="options-outline" label="Device setup" chevron last />
          </Pressable>
        </Card>

        {/* Privacy */}
        <SectionHeader title="Privacy" />
        <Card>
          <SwitchRow
            icon="location-outline"
            label="Location sharing"
            sub={
              locationOffPending
                ? 'Waiting for approval to turn off'
                : locationOn
                  ? 'On (turning off needs approval)'
                  : 'Off'
            }
            value={locationOn}
            disabled={locationOffPending}
            onChange={onToggleLocation}
          />
          <SwitchRow
            icon="battery-half-outline"
            label="Battery sharing"
            sub={privacy?.share_battery ? 'Your partner can see your battery' : 'Off'}
            value={privacy?.share_battery ?? false}
            onChange={onToggleBattery}
          />
          <SwitchRow
            icon="time-outline"
            label="Screen-time visibility"
            value={privacy?.share_screen_time ?? true}
            onChange={(v) => setVisibility('share_screen_time', v)}
          />
          <SwitchRow
            icon="pulse-outline"
            label="Activity visibility"
            value={privacy?.share_activity ?? true}
            onChange={(v) => setVisibility('share_activity', v)}
            last
          />
        </Card>
        <Text style={styles.note}>
          Visibility controls what {partnerName} can see. Turning location sharing off is a shared change, so it needs
          their approval.
        </Text>

        {/* Permissions */}
        <SectionHeader title="Permissions" />
        <Card>
          <Pressable onPress={() => router.push('/optional-setup')}>
            <Row icon="shield-checkmark-outline" label="Manage permissions" chevron last />
          </Pressable>
        </Card>

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
    </SafeAreaView>
  );
}

type IconName = React.ComponentProps<typeof Ionicons>['name'];

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

const styles = StyleSheet.create({
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
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowValue: { ...font.body, color: colors.subtext },
  note: { ...font.small, color: colors.muted, marginTop: spacing.sm, marginHorizontal: spacing.xs, lineHeight: 18 },
});
