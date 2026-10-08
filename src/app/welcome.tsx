import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { isSupabaseConfigured } from '@/lib/supabase';
import { colors, font, spacing } from '@/lib/theme';

/**
 * The first screen. No sign in / sign up — just the mutual pairing entry
 * point, which leads to "Show My Code" or "Enter Their Code".
 */
export default function Welcome() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.hero}>
        <View style={styles.badge}>
          <Ionicons name="heart" size={44} color={colors.primary} />
        </View>
        <Text style={styles.title}>Bond</Text>
        <Text style={styles.tagline}>Your private space for two.</Text>
      </View>

      {!isSupabaseConfigured ? (
        <View style={styles.warning}>
          <Text style={styles.warningText}>
            Supabase isn't set up yet. Add your project URL and key to a{' '}
            <Text style={styles.code}>.env.local</Text> file (see{' '}
            <Text style={styles.code}>.env.example</Text>), then restart the app.
          </Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button label="Mutual Pairing" icon="link-outline" onPress={() => router.push('/pair')} />
        <Text style={styles.footnote}>Connect your Bond with your partner using a simple pairing code.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.xl,
    justifyContent: 'space-between',
  },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  badge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  title: { ...font.hero, fontSize: 44, color: colors.text },
  tagline: { ...font.body, fontSize: 17, color: colors.subtext, marginTop: spacing.sm },
  actions: { paddingBottom: spacing.lg },
  footnote: { ...font.small, color: colors.muted, textAlign: 'center', marginTop: spacing.lg },
  warning: {
    backgroundColor: colors.warningSoft,
    borderRadius: 16,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  warningText: { ...font.small, color: '#8a5a12', lineHeight: 20 },
  code: { fontWeight: '800', color: '#6b4409' },
});
