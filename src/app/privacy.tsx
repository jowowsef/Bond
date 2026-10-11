import React from 'react';
import { LegalDocument } from '@/components/LegalDocument';
import { PRIVACY_POLICY } from '@/content/legal';

export default function PrivacyPolicy() {
  return <LegalDocument doc={PRIVACY_POLICY} />;
}
