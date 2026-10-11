import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useSyncExternalStore } from 'react';
import { Modal, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { answerConfirm, getCurrentConfirm, markHostMounted, subscribeConfirm } from '@/lib/confirmStore';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';

/**
 * Renders Bond's confirmation dialog (see lib/confirmStore.ts). Mounted once
 * in the root layout. Back button / tapping outside = Cancel (nothing changes).
 */
export function ConfirmHost() {
  useThemeVersion();
  const request = useSyncExternalStore(subscribeConfirm, getCurrentConfirm, getCurrentConfirm);

  useEffect(() => {
    markHostMounted(true);
    return () => markHostMounted(false);
  }, []);

  if (!request) return null;
  const accent = request.destructive ? colors.danger : colors.primary;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => answerConfirm('cancel')}>
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityViewIsModal>
          {request.icon ? (
            <View style={[styles.iconWrap, { backgroundColor: request.destructive ? colors.dangerSoft : colors.primarySoft }]}>
              <Ionicons name={request.icon} size={24} color={accent} />
            </View>
          ) : null}
          <Text style={styles.title} accessibilityRole="header">
            {request.title}
          </Text>
          <Text style={styles.body}>{request.body}</Text>
          {request.points?.length ? (
            <View style={styles.points}>
              {request.points.map((p) => (
                <View key={p} style={styles.point}>
                  <View style={[styles.dot, { backgroundColor: accent }]} />
                  <Text style={styles.pointText}>{p}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <View style={styles.actions}>
            <Button
              label={request.confirmLabel}
              variant={request.destructive ? 'danger' : 'primary'}
              onPress={() => answerConfirm('confirm')}
              style={styles.full}
            />
            {request.secondaryLabel ? (
              <Button label={request.secondaryLabel} variant="secondary" onPress={() => answerConfirm('secondary')} style={styles.full} />
            ) : null}
            <Button label={request.cancelLabel ?? 'Cancel'} variant="ghost" onPress={() => answerConfirm('cancel')} style={styles.full} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  backdrop: { flex: 1, backgroundColor: 'rgba(31,42,68,0.45)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  card: { width: '100%', maxWidth: 380, backgroundColor: colors.card, borderRadius: radius.xl, padding: spacing.xl },
  iconWrap: { width: 48, height: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  title: { ...font.h2, color: colors.text },
  body: { ...font.body, color: colors.subtext, marginTop: spacing.sm, lineHeight: 21 },
  points: { marginTop: spacing.md, gap: spacing.xs },
  point: { flexDirection: 'row', alignItems: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 7, marginRight: spacing.sm },
  pointText: { ...font.small, color: colors.text, flex: 1, lineHeight: 19 },
  actions: { marginTop: spacing.xl, gap: spacing.sm },
  full: { alignSelf: 'stretch' },
}));
