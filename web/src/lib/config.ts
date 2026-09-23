function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing ${name} — copy web/.env.example to web/.env.local and fill it in with the deployed PoplaBackendStack's outputs.`
    );
  }
  return value;
}

export const config = {
  appsyncUrl: required('VITE_APPSYNC_URL', import.meta.env.VITE_APPSYNC_URL),
  userPoolId: required('VITE_USER_POOL_ID', import.meta.env.VITE_USER_POOL_ID),
  userPoolClientId: required(
    'VITE_USER_POOL_CLIENT_ID',
    import.meta.env.VITE_USER_POOL_CLIENT_ID
  ),
  // Off by default (unset or anything but 'true') — hides SMS-OTP sign-in
  // from LoginPage in favor of admin-issued temporary passwords. The
  // CUSTOM_AUTH Lambda triggers stay deployed either way; this only
  // controls whether the UI links to them.
  featureSmsOtp: import.meta.env.VITE_FEATURE_SMS_OTP === 'true',
};
