import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { displayCode, unpair, updateDisplayName } from '@/lib/pairing';
import { colors, font, radius, spacing } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * SETTINGS — profile, couple info, privacy toggles (local for now),
 * placeholder permission statuses, and unpair.
 *
 * The name edit and unpair are REAL. The privacy switches and permission
 * rows are UI placeholders this phase; they'll be wired to the device and
 * Supabase in later phases.
 */
export default function Settings() {
  const router = useRouter();
  const { myProfile, partnerProfile, couple, userId, refresh, resetSession } = useCouple();

  const [name, setName] = useState(myProfile?.display_name ?? '');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  // Keep the field in sync if the profile loads after first render.
  useEffect(() => {
    if (myProfile?.display_name) setName(myProfile.display_name);
  }, [myProfile?.display_name]);

  // Local-only privacy switches for this phase.
  const [shareLocation, setShareLocation] = useState(false);
  const [shareScreenTime, setShareScreenTime] = useState(true);
  const [shareActivity, setShareActivity] = useState(true);
  const [notifyRequests, setNotifyRequests] = useState(true);
  const [notifyActivity, setNotifyActivity] = useState(true);

  async function saveName() {
    if (!userId) return;
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed === myProfile?.display_name) return;
    await updateDisplayName(userId, trimmed);
    await refresh();
  }

  async function onCopy() {
    if (!couple) return;
    await Clipboard.setStringAsync(displayCode(couple.invite_code));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function onUnpair() {
    Alert.alert(
      'Unpair couple?',
      'This disconnects you two. Any controls would be turned off. You can pair again anytime.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unpair',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            const result = await unpair();
            if (!result.ok) {
              setBusy(false);
              Alert.alert('Could not unpair', result.message ?? 'Please try again.');
              return;
            }
            await resetSession();
            router.replace('/welcome');
          },
        },
      ],
    );
  }

  return (
    <Screen title="Settings">
      {/* Profile */}
      <Card>
        <View style={styles.profileRow}>
          <Avatar name={name || 'You'} url={myProfile?.avatar_path ? undefined : undefined} size={64} />
          <View style={{ flex: 1, marginLeft: spacing.lg }}>
            <Text style={styles.fieldLabel}>Your name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              onBlur={saveName}
              placeholder="Your name"
              placeholderTextColor={colors.muted}
              style={styles.nameInput}
              maxLength={30}
              returnKeyType="done"
              onSubmitEditing={saveName}
            />
          </View>
        </View>
        <Text style={styles.hint}>Profile photo upload is coming soon.</Text>
      </Card>

      {/* Couple */}
      <SectionHeader title="Couple" />
      <Card>
        <Row icon="heart" label="Partner" value={partnerProfile?.display_name ?? '—'} />
        <Pressable onPress={onCopy}>
          <Row
            icon="key"
            label="Couple code"
            value={displayCode(couple?.invite_code)}
            right={<StatusBadge label={copied ? 'Copied!' : 'Copy'} tone="primary" />}
          />
        </Pressable>
        <Pressable onPress={onUnpair} disabled={busy}>
          <Row icon="unlink" label="Unpair" value="" danger last />
        </Pressable>
      </Card>

      {/* Privacy */}
      <SectionHeader title="Privacy" />
      <Card>
        <SwitchRow icon="location" label="Location sharing" value={shareLocation} onChange={setShareLocation} />
        <SwitchRow icon="hourglass" label="Screen-time visibility" value={shareScreenTime} onChange={setShareScreenTime} />
        <SwitchRow icon="pulse" label="Activity visibility" value={shareActivity} onChange={setShareActivity} last />
      </Card>
      <Text style={styles.sectionNote}>These switches are previews for now and don't change anything yet.</Text>

      {/* Notifications */}
      <SectionHeader title="Notifications" />
      <Card>
        <SwitchRow icon="shield-checkmark" label="Control requests" value={notifyRequests} onChange={setNotifyRequests} />
        <SwitchRow icon="notifications" label="Partner activity" value={notifyActivity} onChange={setNotifyActivity} last />
      </Card>

      {/* Permissions (placeholders) */}
      <SectionHeader title="Permissions" />
      <Card>
        <PermRow icon="location" label="Location" />
        <PermRow icon="notifications" label="Notifications" />
        <PermRow icon="hourglass" label="Usage Access" />
        <PermRow icon="globe" label="Website Protection" />
        <PermRow icon="phone-portrait" label="App Restrictions" last />
      </Card>
      <Text style={styles.sectionNote}>
        Permission setup appears here once the device features are added. Each one is always granted by the phone's
        owner.
      </Text>

      <View style={{ height: spacing.xxl }} />
    </Screen>
  );
}

type IconName = React.ComponentProps<typeof Ionicons>['name'];

function Row({
  icon,
  label,
  value,
  right,
  danger,
  last,
}: {
  icon: IconName;
  label: string;
  value: string;
  right?: React.ReactNode;
  danger?: boolean;
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
        {!right && !value ? <Ionicons name="chevron-forward" size={18} color={colors.muted} /> : null}
      </View>
    </View>
  );
}

function SwitchRow({
  icon,
  label,
  value,
  onChange,
  last,
}: {
  icon: IconName;
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
}) {
  return (
    <View style={[styles.row, !last && styles.divider]}>
      <Ionicons name={icon} size={18} color={colors.primary} style={styles.rowIcon} />
      <Text style={[styles.rowLabel, { color: colors.text }]}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary, false: colors.border }} thumbColor="#fff" />
    </View>
  );
}

function PermRow({ icon, label, last }: { icon: IconName; label: string; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.divider]}>
      <Ionicons name={icon} size={18} color={colors.primary} style={styles.rowIcon} />
      <Text style={[styles.rowLabel, { color: colors.text }]}>{label}</Text>
      <StatusBadge label="Not set up" tone="neutral" />
    </View>
  );
}

const styles = StyleSheet.create({
  profileRow: { flexDirection: 'row', alignItems: 'center' },
  fieldLabel: { ...font.small, color: colors.muted, marginBottom: 4 },
  nameInput: {
    ...font.h2,
    color: colors.text,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 4,
  },
  hint: { ...font.small, color: colors.muted, marginTop: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowIcon: { marginRight: spacing.md, width: 22, textAlign: 'center' },
  rowLabel: { ...font.body, flex: 1 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowValue: { ...font.body, color: colors.subtext },
  sectionNote: { ...font.small, color: colors.muted, marginTop: spacing.sm, marginHorizontal: spacing.xs, lineHeight: 18 },
});
