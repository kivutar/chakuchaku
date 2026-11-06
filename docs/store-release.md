# ChakuChaku store release checklist

This checklist turns the shared static build into App Store and Google Play
releases. Recheck the linked policies before every submission; store rules and
SDK deadlines change independently of this repository.

## Current application identity

- Display name: `ChakuChaku`
- Apple bundle identifier: `com.kivutar.chakuchaku`
- Android application identifier: `com.kivutar.chakuchaku`
- Initial marketing version: `1.0`
- Initial iOS build / Android version code: `1`
- iOS minimum version: 15.0
- Android minimum SDK: 24
- Android target and compile SDK: 36

Google Play requires new phone and tablet submissions to target Android 16
(API 36) from August 31, 2026. New personal developer accounts created after
November 13, 2023 must also complete a closed test with at least 12 opted-in
testers for 14 continuous days before applying for production access.

Sources:

- [Google Play target API requirements](https://developer.android.com/google/play/requirements/target-sdk)
- [Google Play personal-account testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465)
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Apple required-reason API declarations](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api)

## Build inputs

1. Run `npm ci` from a clean checkout.
2. Run `npm test` and `npm run test:voices`.
3. Run `npm run native:sync` and confirm both platforms list all expected
   Capacitor plugins.
4. Confirm the generated native public bundles contain M4A voices and no WAV,
   `.key`, source exercise data, or development cache files.
5. Increment both the visible version and build/version code for every uploaded
   binary. Never reuse a build number already uploaded to either store.

## Android

### Automated Android releases

Publishing a GitHub Release automatically runs
`.github/workflows/android-release.yml` against that release's tag. The job
tests the application, synchronizes the Capacitor project, builds a signed
release APK and Android App Bundle, verifies both signatures, and attaches them
to the GitHub Release as `ChakuChaku-<tag>.apk` and `ChakuChaku-<tag>.aab`.
The APK is for direct installation; the AAB is the Google Play upload. With
`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` configured, the same bundle is published to
both internal testing (`internal`) and the existing closed Alpha test (`alpha`).
This keeps both tester groups on the same version; an internal release alone
does not update the closed test. Draft
releases do not trigger a build; publishing a stable release or pre-release
does. The workflow can also build any Git ref and publish it directly to Google
Play without creating a GitHub Release:

```sh
gh workflow run android-release.yml \
  --ref main \
  -f release_ref=main \
  -f version_name=1.0.11 \
  -f publish_to_google_play=true
```

Manual builds retain their signed APK and AAB as workflow artifacts for 14
days. Set the optional `github_release_tag` input to also attach them to an
existing GitHub Release.

Configure these repository Actions secrets once before publishing a release:

- `ANDROID_KEYSTORE_BASE64`: the release keystore encoded as one Base64 line.
- `ANDROID_KEYSTORE_PASSWORD`: the keystore password.
- `ANDROID_KEY_ALIAS`: the release key alias.
- `ANDROID_KEY_PASSWORD`: the release key password.
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`: the publisher service account JSON,
  with release permissions for internal and closed testing on
  `com.kivutar.chakuchaku`.

Closed-test updates can require Google's review even when the internal release
is already available. Check Play Console's publishing overview after the job
succeeds: the update must be submitted for review, not left as unsent changes.
With managed publishing disabled, approved updates publish automatically.
Tester membership and opt-in are unchanged by an update.

### Production readiness and publication

Production access approval does not itself publish a release. Inspect the
existing store listing, images, production countries, uploaded bundles, and
tracks using the CI publisher account:

```sh
gh workflow run google-play-production.yml -f action=inspect
```

This action uses `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` in CI. It does not export
credentials or publish changes. Its report is attached as a workflow artifact
and includes release lifecycle states, distinguishing review from availability.
Complete missing listing, app-content, pricing, or country setup in Play Console
before production validation. The service account must have production release
permission as well as its existing testing-track permissions.

If testing uploads work but production validation returns `403: The caller does
not have permission`, the account owner must open **Users and permissions** in
Play Console, select the CI publisher account, and enable **Release to
production, exclude devices, and use Play App Signing** for ChakuChaku. Testing
release permission alone does not include production access. See
[Google Play permission definitions](https://support.google.com/googleplay/android-developer/answer/9844686).
Then rerun validation against the same uploaded version code; no rebuild is
needed.

Build and upload the current source with the Android-only workflow above, then
use the resulting version code. Add reviewed English/French release notes as
`docs/releases/android-<version>.json`, with a maximum of 500 characters per
language. For example, validate an uploaded 1.0.17 bundle without publishing:

```sh
gh workflow run google-play-production.yml \
  -f action=validate-production \
  -f version_code=1022 \
  -f release_notes_file=docs/releases/android-1.0.17.json
```

After checking the validation report, the same command with `action=publish`
promotes that exact uploaded bundle to production and submits the changes for
Google's normal review. It does not rebuild the application. The workflow
rejects untested version codes, downgrades, and replacement of unfinished
production rollouts. Managed publishing and any further Console-only review
steps still apply; an API commit is not proof of public store availability.

The first production rollout serves all users in the selected countries;
staged percentage rollouts apply to later updates. Source:
[Google Play release preparation and rollout](https://support.google.com/googleplay/android-developer/answer/9859348).

On Arch Linux, create and upload a private release keystore with:

```sh
keytool -genkeypair -v \
  -keystore chakuchaku-release.jks \
  -alias chakuchaku \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000
base64 -w 0 chakuchaku-release.jks > chakuchaku-release.jks.base64
gh secret set ANDROID_KEYSTORE_BASE64 < chakuchaku-release.jks.base64
gh secret set ANDROID_KEYSTORE_PASSWORD
gh secret set ANDROID_KEY_ALIAS
gh secret set ANDROID_KEY_PASSWORD
```

Keep an offline backup of the keystore and its credentials. Losing the signing
key can prevent future APK updates. Neither the keystore nor the Base64 copy
belongs in Git. Use version tags such as `v1.0.0`; the tag becomes Android's
visible `versionName`, while the workflow run number becomes its monotonically
increasing `versionCode` with a 1000-point offset from the original local
builds.

The generated APK is useful for direct installation and testing. Upload the AAB
from the same release to Google Play after the APK has passed device testing.

### Device and store checks

1. Install the Android API 36 SDK. Android Studio is optional; Gradle and the
   command-line SDK tools are sufficient.
2. Open the project with `npm run android:open` or run a device build with
   `npm run android:run`.
3. Confirm the merged release manifest does **not** contain
   `SCHEDULE_EXACT_ALARM`. Daily reminders are intentionally inexact.
4. Test Android 7/API 24 and current Android, gesture and three-button back,
   notification denial/approval, IME resizing, offline launch, audio playback,
   progress export/import, and process death/relaunch.
5. Confirm the private upload key is backed up and the GitHub Actions secrets
   are configured. Do not commit a keystore or credentials.
6. Build an Android App Bundle with `./gradlew bundleRelease`, upload it to the
   Play internal track, then run the required closed test if the account is in
   scope.

## iOS

### Automated TestFlight uploads

Publishing a GitHub Release automatically runs
`.github/workflows/ios-release.yml` against that release's tag. A managed macOS
runner tests the shared application, synchronizes the Capacitor iOS project,
archives and exports a manually signed IPA, validates it, and uploads it to App
Store Connect. Apple processes the upload before it appears as a TestFlight
build; the workflow does not submit the build for App Review.

For an iOS-only update, run the same workflow manually with a Git ref and a new
numeric marketing version. This avoids triggering the Android release workflow
or uploading a build to Google Play. For example:

```sh
gh workflow run ios-release.yml \
  --ref main \
  -f release_ref=main \
  -f version_name=1.0.10
```

Use numeric release tags such as `v1.0.1`. The tag becomes
`CFBundleShortVersionString`. The workflow run number and retry attempt form a
monotonically increasing `CFBundleVersion`, so a retry can produce a new upload.

The repository requires these encrypted Actions secrets:

- `APP_STORE_CONNECT_KEY_BASE64`
- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `IOS_DISTRIBUTION_CERTIFICATE_BASE64`
- `IOS_DISTRIBUTION_CERTIFICATE_PASSWORD`
- `IOS_PROVISIONING_PROFILE_BASE64`

Keep offline backups of the original `.p8`, the distribution `.p12` and its
password, and the `.mobileprovision` file. They are ignored by Git. The current
distribution certificate and profile expire on August 19, 2027; replace the
certificate/profile and their three signing secrets before then.

### Device and store checks

1. For optional local development on a Mac, run `npm run ios:open`, select team
   `ZE9XE938Z2`, and keep the project's automatic development signing enabled.
   Release CI overrides it with the managed App Store signing identity.
2. Confirm `PrivacyInfo.xcprivacy` is present in the built app and includes the
   approved UserDefaults (`CA92.1`) and file timestamp (`C617.1`) reasons.
3. Test the oldest supported iOS version and a current iPhone: safe areas,
   light/dark system appearance, notification denial/approval, Japanese and
   English keyboards, offline launch, audio, progress export/import, and app
   relaunch.
4. In App Store Connect, complete export-compliance and beta information, assign
   the processed build to internal TestFlight testers, and test it before App
   Review.

## Privacy and store forms

The public and in-app policy URL is
`https://kivutar.github.io/chakuchaku/privacy.html`. Apple requires a privacy-policy
link both in App Store Connect and inside the app.

Baseline declarations, to be confirmed against the final binary:

- No accounts, analytics, advertising, tracking, contacts, location, camera,
  microphone, or advertising identifier.
- SRS state, answers, and settings remain on the device unless the learner
  explicitly exports a backup.
- Notification permission is optional and requested only when the learner
  enables a daily reminder.
- Optional AI autocorrection sends user-entered answer text and exercise context
  directly to OpenAI using the learner's own key. Disclose this as optional User
  Content used for App Functionality, not linked to an account and not used for
  tracking. Requests set `store: false`; default API abuse-monitoring logs may
  still retain prompts and responses for up to 30 days. Recheck
  [OpenAI's API data controls](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint)
  before submitting the privacy forms.
- The API key is session-only and excluded from progress backups.

## Store assets and review notes

- Export final 1024 px iOS and 512 px Google Play icons from the approved art.
- Capture truthful phone screenshots for Grammar, Kana, Vocabulary, Statistics,
  and the progress backup controls. Do not include placeholder or generated
  content that differs from the submitted binary.
- Suggested subtitle/short description: `Build Japanese steadily, one review at a time.`
- Explain in review notes that the app works offline, has no account, and that
  AI autocorrection and daily reminders are optional. Provide exact steps for
  reviewers to locate both features.
- Use the repository issue tracker as the support URL until a dedicated support
  page or email address is available.

## Rollback and learner safety

- Keep the previous accepted binaries available in the store consoles until the
  new rollout is stable.
- The first Google Play production release reaches all selected countries;
  start later production updates with a staged rollout.
- Never change SRS or statistics storage versions without a tested migration.
- Before a risky persistence change, ask TestFlight/closed-test users to export
  a progress backup and verify that the previous release can still import it.
