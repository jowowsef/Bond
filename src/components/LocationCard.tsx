import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from './Card';
import { colors, font, radius, spacing } from '@/lib/theme';

/**
 * A small location preview for Home: a simple stylised "map" (soft blocks
 * for city streets), a dot for each person who is sharing, and a one-line
 * summary. It's a preview only — the real map lives in the Location tab.
 */
export function LocationCard({
  updatedLabel,
  meSharing,
  partnerSharing,
  partnerName,
  distanceKm,
  onPress,
}: {
  updatedLabel: string;
  meSharing: boolean;
  partnerSharing: boolean;
  partnerName: string;
  distanceKm?: number | null;
  onPress?: () => void;
}) {
  const summary =
    meSharing && partnerSharing
      ? distanceKm != null
        ? `You're ${distanceKm.toFixed(1)} km apart`
        : 'You are both sharing'
      : partnerSharing
        ? 'Your location sharing is off'
        : meSharing
          ? `${partnerName} isn't sharing right now`
          : 'Location sharing is off for both of you';

  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      <Card>
        <View style={styles.header}>
          <Text style={styles.title}>Location</Text>
          <Text style={styles.updated}>{updatedLabel}</Text>
        </View>

        <View style={styles.map}>
          <View style={styles.mapRow}>
            <View style={[styles.block, { flex: 3 }]} />
            <View style={[styles.block, { flex: 2 }]} />
          </View>
          <View style={[styles.mapRow, styles.mapRowGap]}>
            <View style={[styles.block, { flex: 3 }]} />
            <View style={[styles.block, { flex: 2 }]} />
          </View>
          {meSharing ? <View style={[styles.dot, { backgroundColor: colors.me, left: '38%', top: '30%' }]} /> : null}
          {partnerSharing ? (
            <View style={[styles.dot, { backgroundColor: colors.partner, left: '74%', top: '62%' }]} />
          ) : null}
        </View>

        <Text style={styles.summary}>{summary}</Text>
      </Card>
    </Pressable>
  );
}

const DOT = 16;

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  title: { ...font.h3, color: colors.text },
  updated: { ...font.small, color: colors.subtext },
  map: { height: 88, borderRadius: radius.md, overflow: 'hidden' },
  mapRow: { flex: 1, flexDirection: 'row', gap: 4 },
  mapRowGap: { marginTop: 4 },
  block: { backgroundColor: colors.track, borderRadius: 8 },
  dot: {
    position: 'absolute',
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 3,
    borderColor: colors.card,
    marginLeft: -DOT / 2,
    marginTop: -DOT / 2,
  },
  summary: { ...font.small, color: colors.subtext, marginTop: spacing.md },
});
