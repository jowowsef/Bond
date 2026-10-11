import React from 'react';
import { LegalDocument } from '@/components/LegalDocument';
import { TERMS_OF_USE } from '@/content/legal';

export default function TermsOfUse() {
  return <LegalDocument doc={TERMS_OF_USE} />;
}
