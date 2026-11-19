# CloudVault

CloudVault is a personal file manager for a user's own Telegram **Saved Messages**. Telegram stores the actual file bytes; CloudVault stores account identity and folder metadata only.

## How it works

- **Web/PWA:** responsive dark interface and browser Telegram connection.
- **Android:** native WebView shell with a Kotlin TDLib bridge. Telegram account access, upload and download run on-device.
- **Storage rule:** the Android bridge resolves the connected user's own Saved Messages chat internally. It does not accept a chat, channel or group ID from the web UI.
- **Backend:** CloudVault email/password account, device sessions, folder names and message-ID assignments. It must never receive Telegram OTPs, 2FA passwords, API hashes, TDLib session databases or file bytes.
- **Android security:** TDLib data is in app-private storage and protected by an encryption key wrapped with Android Keystore. The app does not sync that local session to CloudVault.

## Telegram API credentials

Telegram requires a legitimate API ID and API hash for third-party user-account clients, including TDLib. CloudVault cannot bypass that requirement or borrow another app's credentials. The user enters their own credentials once; they are stored inside the password-encrypted local vault and are not sent to CloudVault's backend. Telegram phone verification and optional 2FA are handled directly on the device.

## Source layout

The active source is bundled in `source/native-bundle/part*.b64` so it can be transported through the repository's mobile-friendly workflow. It contains:

- `web/` — editable web/PWA source
- `android/` — native Android shell and Kotlin TDLib bridge
- `server/` — optional Node/Postgres account API
- `test/` — domain tests
- `package.json`, `Dockerfile`, `.dockerignore`, `DEPLOY.md`

The previous `source/chunk*.b64` bundle is retained. The separate `video-studio/` directory is an existing project and is not part of CloudVault's Android build.

To extract the current app source in a development environment:

```sh
cat source/native-bundle/part*.b64 | base64 -d | tar -xJ -C .
npm test
sh build.sh
```

## Build and deployment

Vercel runs `build.sh`, which extracts only the web app into `public/`; the existing `/api/*` rewrite continues to forward requests to the configured Supabase Edge Function. GitHub Actions expands the same source bundle, runs the web tests, and assembles a debug Android APK. A successful CI build proves compilation, not successful Telegram login or file transfer on a physical phone.

The Dockerfile can build the optional self-hosted Node/Postgres API. See `DEPLOY.md` inside the source bundle for configuration details.

## Status

The native Android bridge has been scaffolded, but a real Android build and Telegram end-to-end validation are still required. There is no signed Play Store release key in this repository. The debug APK is for testing only.

CloudVault is independent and is not affiliated with or endorsed by Telegram. Follow Telegram's API terms and avoid automated or abnormal upload activity that may cause account limitations.
