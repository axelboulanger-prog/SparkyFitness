import { readFileSync } from 'node:fs';

const DEV_BUNDLE_IDENTIFIER =
  process.env.EXPO_DEV_BUNDLE_IDENTIFIER ||
  'org.SparkyApps.SparkyFitnessMobile1.dev';
const IOS_APP_GROUP_DEV =
  process.env.IOS_APP_GROUP_DEV ||
  'group.org.SparkyApps.SparkyFitnessMobile1.dev';
const IOS_APP_GROUP_PROD =
  process.env.IOS_APP_GROUP_PROD ||
  'group.com.SparkyApps.SparkyFitnessMobile.shared';
const getIosAppGroup = () => {
  const environment = process.env.APP_VARIANT || 'dev';
  return environment === 'dev' || environment === 'development'
    ? IOS_APP_GROUP_DEV
    : IOS_APP_GROUP_PROD;
};
const APP_NAME = 'SparkyFitness';
const APP_SLUG = 'sparkyfitnessmobile';
const ANDROID_PROD_BUNDLE_IDENTIFIER = 'com.SparkyApps.SparkyFitnessMobile';
const IOS_PROD_BUNDLE_IDENTIFIER = 'com.SparkyApps.SparkyFitnessMobile';
const DEV_APPLE_TEAM_ID = process.env.EXPO_DEV_APPLE_TEAM_ID || '0000000000';
const PROD_APPLE_TEAM_ID = process.env.EXPO_PROD_APPLE_TEAM_ID || '0000000000';
const DEV_PACKAGE = DEV_BUNDLE_IDENTIFIER;
const PROD_PACKAGE = ANDROID_PROD_BUNDLE_IDENTIFIER;
const NATIVE_LANGUAGE_TAGS = ['en', 'pl', 'es'];

const androidPermissions = [
  'android.permission.INTERNET',
  'android.permission.health.READ_ACTIVE_CALORIES_BURNED',
  'android.permission.health.READ_BASAL_BODY_TEMPERATURE',
  'android.permission.health.READ_BASAL_METABOLIC_RATE',
  'android.permission.health.READ_BLOOD_GLUCOSE',
  'android.permission.health.READ_BLOOD_PRESSURE',
  'android.permission.health.READ_BODY_FAT',
  'android.permission.health.READ_BODY_TEMPERATURE',
  'android.permission.health.READ_BONE_MASS',
  'android.permission.health.READ_CERVICAL_MUCUS',
  'android.permission.health.READ_CYCLING_PEDALING_CADENCE',
  'android.permission.health.READ_EXERCISE',
  'android.permission.health.READ_EXERCISE_ROUTES',
  'android.permission.health.READ_DISTANCE',
  'android.permission.health.READ_ELEVATION_GAINED',
  'android.permission.health.READ_FLOORS_CLIMBED',
  'android.permission.health.READ_HEART_RATE',
  'android.permission.health.READ_HEART_RATE_VARIABILITY',
  'android.permission.health.READ_HEIGHT',
  'android.permission.health.READ_HYDRATION',
  'android.permission.health.READ_NUTRITION',
  'android.permission.health.READ_LEAN_BODY_MASS',
  'android.permission.health.READ_INTERMENSTRUAL_BLEEDING',
  'android.permission.health.READ_MENSTRUATION',
  'android.permission.health.READ_OVULATION_TEST',
  'android.permission.health.READ_OXYGEN_SATURATION',
  'android.permission.health.READ_POWER',
  'android.permission.health.READ_RESPIRATORY_RATE',
  'android.permission.health.READ_RESTING_HEART_RATE',
  'android.permission.health.READ_SLEEP',
  'android.permission.health.READ_SPEED',
  'android.permission.health.READ_STEPS',
  'android.permission.health.READ_STEPS_CADENCE',
  'android.permission.health.READ_TOTAL_CALORIES_BURNED',
  'android.permission.health.READ_VO2_MAX',
  'android.permission.health.READ_WEIGHT',
  'android.permission.health.READ_WHEELCHAIR_PUSHES',
  'android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND',
  'android.permission.health.READ_HEALTH_DATA_HISTORY',
  'android.permission.health.WRITE_NUTRITION',
  'android.permission.health.WRITE_HYDRATION',
  'android.permission.SCHEDULE_EXACT_ALARM',
];

const devAndroidPermissions = [
  'android.permission.health.WRITE_ACTIVE_CALORIES_BURNED',
  'android.permission.health.WRITE_BASAL_BODY_TEMPERATURE',
  'android.permission.health.WRITE_BASAL_METABOLIC_RATE',
  'android.permission.health.WRITE_BLOOD_GLUCOSE',
  'android.permission.health.WRITE_BLOOD_PRESSURE',
  'android.permission.health.WRITE_BODY_FAT',
  'android.permission.health.WRITE_BODY_TEMPERATURE',
  'android.permission.health.WRITE_BONE_MASS',
  'android.permission.health.WRITE_CERVICAL_MUCUS',
  'android.permission.health.WRITE_CYCLING_PEDALING_CADENCE',
  'android.permission.health.WRITE_EXERCISE',
  'android.permission.health.WRITE_EXERCISE_ROUTE',
  'android.permission.health.WRITE_DISTANCE',
  'android.permission.health.WRITE_ELEVATION_GAINED',
  'android.permission.health.WRITE_FLOORS_CLIMBED',
  'android.permission.health.WRITE_HEART_RATE',
  'android.permission.health.WRITE_HEIGHT',
  'android.permission.health.WRITE_LEAN_BODY_MASS',
  'android.permission.health.WRITE_INTERMENSTRUAL_BLEEDING',
  'android.permission.health.WRITE_MENSTRUATION',
  'android.permission.health.WRITE_OVULATION_TEST',
  'android.permission.health.WRITE_OXYGEN_SATURATION',
  'android.permission.health.WRITE_POWER',
  'android.permission.health.WRITE_RESPIRATORY_RATE',
  'android.permission.health.WRITE_RESTING_HEART_RATE',
  'android.permission.health.WRITE_SLEEP',
  'android.permission.health.WRITE_SPEED',
  'android.permission.health.WRITE_STEPS',
  'android.permission.health.WRITE_STEPS_CADENCE',
  'android.permission.health.WRITE_TOTAL_CALORIES_BURNED',
  'android.permission.health.WRITE_VO2_MAX',
  'android.permission.health.WRITE_WEIGHT',
  'android.permission.health.WRITE_WHEELCHAIR_PUSHES',
];

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
);

export default ({ config }) => {
  const environment = process.env.APP_VARIANT || 'dev';
  const isDev = environment === 'dev' || environment === 'development';
  if (isDev) androidPermissions.push(...devAndroidPermissions);

  const prodPlugins = ['./plugins/withNetworkSecurityConfig'];
  return {
    ...config,
    name: APP_NAME,
    slug: APP_SLUG,
    version: packageJson.version,
    locales: Object.fromEntries(
      NATIVE_LANGUAGE_TAGS.map((language) => [
        language,
        `./locales/${language}.json`,
      ])
    ),
    ios: {
      bundleIdentifier: isDev
        ? DEV_BUNDLE_IDENTIFIER
        : IOS_PROD_BUNDLE_IDENTIFIER,
      appleTeamId: isDev ? DEV_APPLE_TEAM_ID : PROD_APPLE_TEAM_ID,
      supportsTablet: false,
      infoPlist: {
        NSLocalNetworkUsageDescription:
          'SparkyFitness connects to self-hosted servers on your local network.',
        NSCameraUsageDescription:
          'SparkyFitness uses the camera to photograph foods and meals, and to scan barcodes and nutrition labels.',
        NSPhotoLibraryUsageDescription:
          'SparkyFitness lets you choose photos from your library for your foods, meals, and diary entries.',
        NSAppTransportSecurity: { NSAllowsArbitraryLoads: false },
        ITSAppUsesNonExemptEncryption: false,
        UIPrefersShowingLanguageSettings: true,
        CFBundleAllowMixedLocalizations: true,
      },
      entitlements: {
        'com.apple.security.application-groups': [getIosAppGroup()],
      },
      icon: './assets/icons/appicon.icon',
    },
    android: {
      package: isDev ? DEV_PACKAGE : PROD_PACKAGE,
      permissions: androidPermissions,
      adaptiveIcon: {
        foregroundImage: './assets/icons/adaptiveicon.png',
        backgroundColor: '#FFFFFF',
      },
    },
    plugins: [
      ...(config.plugins ?? []),
      'expo-image',
      [
        'expo-audio',
        {
          microphonePermission: false,
          recordAudioAndroid: false,
          enableBackgroundPlayback: false,
        },
      ],
      './plugins/withGlanceAndroidSupport',
      './plugins/withAppLanguage',
      './plugins/withCalorieWidget',
      './plugins/withExactAlarmModule',
      './plugins/withEnrichedMarkdownNoMath',
      [
        'expo-localization',
        {
          supportedLocales: {
            ios: NATIVE_LANGUAGE_TAGS,
            android: NATIVE_LANGUAGE_TAGS,
          },
        },
      ],
      [
        'expo-widgets',
        {
          groupIdentifier: getIosAppGroup(),
          bundleIdentifier:
            process.env.WIDGET_BUNDLE_IDENTIFIER ||
            (isDev
              ? `${DEV_BUNDLE_IDENTIFIER}.ExpoWidgetsTarget`
              : 'com.SparkyApps.SparkyFitnessMobile.ExpoWidgetsTarget'),
          widgets: [],
        },
      ],
      ...(!isDev ? prodPlugins : []),
    ],
    extra: {
      ...config.extra,
      APP_VARIANT: environment,
      iosAppGroup: getIosAppGroup(),
    },
  };
};
