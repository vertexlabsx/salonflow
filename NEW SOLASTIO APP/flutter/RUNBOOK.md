# Solastio Flutter Runbook

## Configure Backend URL

Use a compile-time define for every run/build:

```bash
flutter run --dart-define=SOLASTIO_API_BASE=http://127.0.0.1:4000
flutter build windows --dart-define=SOLASTIO_API_BASE=https://api.your-domain.com
flutter build apk --dart-define=SOLASTIO_API_BASE=https://api.your-domain.com
```

## Android Release Signing

Create `android/key.properties` from `android/key.properties.example` and point
`storeFile` to your production keystore before publishing to the Play Store.
The real `key.properties` and keystore files are ignored by git.

## Verification Order

1. Start the Rust backend with seeded tenant/staff/owner data.
2. Login as staff and walk Today, Appointments, Tasks, Chat, Attendance, Roster, Leaves, Payroll, Clients, Notifications, Settings.
3. Login as owner/admin and walk Owner dashboard plus every owner section.
4. Create test records for branches, services, clients, expenses, gift cards, bundles, promos.
5. Trigger offline write actions, confirm they enter the sync queue, then reconnect and flush from Settings.

## Build Checks

Run these before release:

```bash
flutter analyze
flutter test
flutter build windows --dart-define=SOLASTIO_API_BASE=https://api.your-domain.com
flutter build apk --dart-define=SOLASTIO_API_BASE=https://api.your-domain.com
```
