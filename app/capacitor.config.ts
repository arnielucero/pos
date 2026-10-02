import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ph.hmr.pos',
  appName: 'HMR POS',
  webDir: 'dist',
  android: {
    // Never allow http:// requests from the https WebView origin.
    allowMixedContent: false,
    // WebView remote debugging: MainActivity enables it only for debuggable builds.
    captureInput: true,
  },
  server: {
    androidScheme: 'https',
  },
  plugins: {
    // Native HTTP stack: requests go through OkHttp and obey network_security_config.xml
    // (cleartext only allowed in debug builds for dev hosts) and are not subject to WebView CORS.
    CapacitorHttp: { enabled: true },
    CapacitorSQLite: {
      androidIsEncryption: true,
      androidBiometric: { biometricAuth: false, biometricTitle: '', biometricSubTitle: '' },
    },
  },
};

export default config;
