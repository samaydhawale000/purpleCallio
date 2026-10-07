/**
 * Feature keys the server enforces or displays. The `Feature` table is the
 * registry of record (labels, ordering, visibility are admin-editable);
 * these constants exist so code can check entitlements by key —
 * EntitlementService.hasFeature(userId, FeatureKey.WEBHOOKS) — instead of
 * comparing plan names anywhere.
 */
export const FeatureKey = {
  HOSTED_UI: 'HOSTED_UI',
  WEBRTC_SDK: 'WEBRTC_SDK',
  REST_API: 'REST_API',
  REACT_COMPONENTS: 'REACT_COMPONENTS',
  SCREEN_SHARING: 'SCREEN_SHARING',
  WEBHOOKS: 'WEBHOOKS',
  ANALYTICS: 'ANALYTICS',
  CUSTOM_BRANDING: 'CUSTOM_BRANDING',
} as const;

export type FeatureKeyValue = (typeof FeatureKey)[keyof typeof FeatureKey];

/** Initial registry rows (only inserted when the Feature table is empty). */
export const DEFAULT_FEATURES: {
  key: string;
  name: string;
  description: string;
  category: string;
}[] = [
  {
    key: FeatureKey.HOSTED_UI,
    name: 'Hosted meeting UI',
    description: 'Drop-in call pages hosted by PurpleCallio.',
    category: 'Platform',
  },
  {
    key: FeatureKey.WEBRTC_SDK,
    name: 'WebRTC SDKs',
    description: 'Headless SDKs for web, React Native and more.',
    category: 'Platform',
  },
  {
    key: FeatureKey.REST_API,
    name: 'REST API & signaling',
    description: 'Create and manage calls from your backend.',
    category: 'Platform',
  },
  {
    key: FeatureKey.REACT_COMPONENTS,
    name: 'React UI components',
    description: 'Prebuilt call UI components.',
    category: 'Platform',
  },
  {
    key: FeatureKey.SCREEN_SHARING,
    name: 'Screen sharing',
    description: 'Share a screen during video calls.',
    category: 'Calling',
  },
  {
    key: FeatureKey.WEBHOOKS,
    name: 'Webhook events',
    description: 'Signed call lifecycle webhooks.',
    category: 'Platform',
  },
  {
    key: FeatureKey.ANALYTICS,
    name: 'Usage analytics',
    description: 'Per-call usage timelines and history.',
    category: 'Platform',
  },
  {
    key: FeatureKey.CUSTOM_BRANDING,
    name: 'Custom branding',
    description: 'Your logo, colors and name on hosted call pages.',
    category: 'Platform',
  },
];

/**
 * Everything every account could use before the prepaid launch. The default
 * plans include all of it so no existing customer silently loses a
 * capability. Only add a feature here once it actually ships.
 */
export const CORE_FEATURES: string[] = [
  FeatureKey.HOSTED_UI,
  FeatureKey.WEBRTC_SDK,
  FeatureKey.REST_API,
  FeatureKey.REACT_COMPONENTS,
  FeatureKey.SCREEN_SHARING,
  FeatureKey.WEBHOOKS,
  FeatureKey.ANALYTICS,
  FeatureKey.CUSTOM_BRANDING,
];
