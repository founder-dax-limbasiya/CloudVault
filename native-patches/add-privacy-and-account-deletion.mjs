#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const webDir = process.argv[2];
const serverFile = process.argv[3];
if (!webDir) {
  console.error("Usage: node native-patches/add-privacy-and-account-deletion.mjs <web-dir> [server-index]");
  process.exit(2);
}
if (!fs.existsSync(webDir)) {
  console.error("Web directory not found: " + webDir);
  process.exit(1);
}

const mainFile = path.join(webDir, "src", "main.js");
if (!fs.existsSync(mainFile)) throw new Error("web/src/main.js was not found.");
let main = fs.readFileSync(mainFile, "utf8");
const oldAccountCard = '<div class="settings-foot"><span>CloudVault account session on this device</span><button class="danger-button" data-action="account-sign-out">Sign out</button></div></section>';
const newAccountCard = '<div class="settings-foot"><span>CloudVault account session on this device</span><a class="text-button" href="/privacy-policy.html">Privacy policy</a><a class="danger-button" href="/delete-account.html">Delete account</a><button class="danger-button" data-action="account-sign-out">Sign out</button></div></section>';
if (main.includes(oldAccountCard)) {
  main = main.replace(oldAccountCard, newAccountCard);
} else if (!main.includes('href="/delete-account.html"') || !main.includes('href="/privacy-policy.html"')) {
  throw new Error("Could not locate the CloudVault account settings card; refusing to patch a different layout.");
}
fs.writeFileSync(mainFile, main);

if (serverFile && fs.existsSync(serverFile)) {
  let server = fs.readFileSync(serverFile, "utf8");
  const logoutMarker = "  if (req.method === 'POST' && path === '/api/auth/logout') {";
  const deleteRoute = [
    "  if (req.method === 'DELETE' && path === '/api/auth/account') {",
    "    const session = await currentSession(req); if (!session) return json(res, 401, { error: 'Please sign in.' });",
    "    const data = await body(req); const password = String(data.password || '');",
    "    if (!password || password.length > 200) return json(res, 400, { error: 'Enter your CloudVault password to confirm deletion.' });",
    "    const user = await pool.query('SELECT password_salt,password_hash FROM cv_users WHERE id=$1', [session.user_id]);",
    "    if (!user.rowCount || !(await verifyPassword(password, user.rows[0].password_salt, user.rows[0].password_hash))) return json(res, 401, { error: 'CloudVault password is incorrect.' });",
    "    await pool.query('DELETE FROM cv_users WHERE id=$1', [session.user_id]);",
    "    clearSessionCookie(res);",
    "    return json(res, 200, { ok: true, deleted: true, telegramMessagesDeleted: false });",
    "  }",
    ""
  ].join("\n");
  if (server.includes(logoutMarker) && !server.includes("path === '/api/auth/account'")) {
    server = server.replace(logoutMarker, deleteRoute + logoutMarker);
    fs.writeFileSync(serverFile, server);
  } else if (!server.includes("path === '/api/auth/account'")) {
    throw new Error("Could not find Node server logout route to add account deletion.");
  }
}

const storageFile = path.join(webDir, 'src', 'storage.js');
if (!fs.existsSync(storageFile)) throw new Error('web/src/storage.js was not found.');
let storage = fs.readFileSync(storageFile, 'utf8');
if (!storage.includes('export const clearLocalAccountData')) {
  if (!storage.includes("export const clearEncryptedVault = () => requestStore('vault', 'readwrite', (store) => store.delete('primary'));")) throw new Error('Could not find the local encrypted vault clear function.');
  storage = storage.replace("export const clearEncryptedVault = () => requestStore('vault', 'readwrite', (store) => store.delete('primary'));", "export const clearEncryptedVault = () => requestStore('vault', 'readwrite', (store) => store.delete('primary'));\nexport const clearLocalAccountData = async () => {\n  const db = await openDb();\n  try {\n    await new Promise((resolve, reject) => {\n      const tx = db.transaction(['vault', 'folders', 'assignments'], 'readwrite');\n      tx.objectStore('vault').clear();\n      tx.objectStore('folders').clear();\n      tx.objectStore('assignments').clear();\n      tx.oncomplete = () => resolve();\n      tx.onerror = () => reject(tx.error || new Error('Could not clear local CloudVault data.'));\n      tx.onabort = () => reject(tx.error || new Error('Local CloudVault data deletion was aborted.'));\n    });\n  } finally { db.close(); }\n}");
  fs.writeFileSync(storageFile, storage);
}
const policy = [
  "<!doctype html>",
  '<html lang="en">',
  "<head>",
  '  <meta charset="utf-8">',
  '  <meta name="viewport" content="width=device-width, initial-scale=1">',
  '  <meta name="robots" content="index,follow">',
  "  <title>Privacy Policy · CloudVault</title>",
  '  <meta name="description" content="How CloudVault handles account, device, folder and Telegram connection data.">',
  "  <style>",
  "    :root{color-scheme:dark;--bg:#0b1020;--panel:#121a2d;--text:#edf2ff;--muted:#9eabc4;--line:#27344d;--accent:#9bb8ff}",
  "    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.7 system-ui,-apple-system,Segoe UI,sans-serif}",
  "    main{width:min(900px,calc(100% - 32px));margin:40px auto 80px}header,section{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:24px;margin:16px 0}",
  "    h1,h2{line-height:1.25}h1{font-size:clamp(2rem,6vw,3rem);margin:6px 0}h2{font-size:1.2rem;margin:0 0 10px}p,li{color:#d6deef}small,.muted{color:var(--muted)}a{color:var(--accent)}ul{padding-left:22px}",
  "    .brand{font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);font-size:.8rem}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:18px}",
  "    .actions a{display:inline-block;border:1px solid var(--line);border-radius:10px;padding:9px 14px;text-decoration:none}",
  "  </style>",
  "</head>",
  "<body><main>",
  "  <header><div class='brand'>CloudVault</div><h1>Privacy Policy</h1><p class='muted'>Last updated: 19 November 2026</p>",
  "    <p>This policy explains how CloudVault handles information when you use the CloudVault website and Android application. CloudVault is an independent third-party application and is not affiliated with or endorsed by Telegram.</p>",
  "  </header>",
  "  <section><h2>1. Information CloudVault handles</h2>",
  "    <ul>",
  "      <li><strong>Account information:</strong> email address, optional display name, password salt and password hash. CloudVault does not store your plain-text password.</li>",
  "      <li><strong>Device and session information:</strong> a hashed CloudVault session token, device label, browser or app user-agent, sign-in time, last activity and session expiry.</li>",
  "      <li><strong>Organisation metadata:</strong> folder names, folder identifiers and Telegram Saved Messages message identifiers used to map files into folders.</li>",
  "      <li><strong>Local app information:</strong> Telegram connection/session data and temporary app state needed to connect to your own Telegram account. These are handled on your device and are not intended to be stored in CloudVault's account database.</li>",
  "    </ul>",
  "  </section>",
  "  <section><h2>2. Where your files are stored</h2>",
  "    <p>CloudVault is a file manager for your own Telegram Saved Messages. File contents that you choose to upload are sent to Telegram and stored in your Telegram account. CloudVault's backend stores folder and message-index metadata, not a separate copy of the file contents.</p>",
  "    <p>Deleting your CloudVault account does not delete messages or files from Telegram. To remove those files, delete the relevant messages directly in Telegram. Telegram's own terms, privacy practices and retention controls apply to data stored by Telegram.</p>",
  "  </section>",
  "  <section><h2>3. Telegram connection</h2>",
  "    <p>CloudVault uses the Telegram API. You connect your Telegram account on each device using your own Telegram API credentials and Telegram's authentication process. Do not share your login code, two-step verification password, API hash or device with anyone. CloudVault does not ask you to send Telegram OTPs or two-step verification passwords to its servers.</p>",
  "    <p>Your use of Telegram is also subject to the <a href='https://telegram.org/privacy' target='_blank' rel='noopener noreferrer'>Telegram Privacy Policy</a> and <a href='https://core.telegram.org/api/terms' target='_blank' rel='noopener noreferrer'>Telegram API Terms</a>.</p>",
  "  </section>",
  "  <section><h2>4. Service providers and sharing</h2>",
  "    <p>CloudVault uses Supabase to operate its account database and API, and Vercel to host and deliver the web application. Telegram receives and stores the file messages you send to your Saved Messages. These providers process information as needed to provide their respective services and under their own terms and privacy documentation.</p>",
  "    <p>CloudVault does not sell your personal information. Information may be disclosed where required by law or to protect the service, its users or their security.</p>",
  "  </section>",
  "  <section><h2>5. Security</h2>",
  "    <p>CloudVault uses encrypted network connections, password hashing and session controls. Telegram session material is handled locally by the app. No internet-connected service can guarantee absolute security; keep your device and Telegram account protected and do not use CloudVault as your only backup of important files.</p>",
  "  </section>",
  "  <section><h2>6. Retention and account deletion</h2>",
  "    <p>You can initiate account deletion inside the app from Settings or from the public page below. After your password is verified, CloudVault deletes your account record, active CloudVault sessions, folders, folder assignments and related account metadata. The app's account data is removed from CloudVault's database through the linked database records.</p>",
  "    <p>Telegram Saved Messages content is not deleted by this process because it is stored by Telegram, not CloudVault. Local Telegram app data on a device may need to be cleared by disconnecting the Telegram account or removing CloudVault data on that device. Operational security logs maintained by service providers may persist under their own retention rules.</p>",
  "    <div class='actions'><a href='/delete-account.html'>Delete CloudVault account</a><a href='https://cloudvault-pi.vercel.app/'>Back to CloudVault</a></div>",
  "  </section>",
  "  <section><h2>7. Children and changes</h2>",
  "    <p>CloudVault is a general-purpose file management tool and is not designed specifically for children. We may update this policy as the service changes. The latest version will be published at this URL with its updated date.</p>",
  "  </section>",
  "  <section><h2>8. Privacy questions</h2>",
  "    <p>For account deletion, use the <a href='/delete-account.html'>CloudVault account deletion page</a>. For other support or privacy questions, use the developer contact email shown on the CloudVault Google Play listing. Do not send passwords, OTPs, Telegram API hashes or private files in support requests.</p>",
  "  </section>",
  "</main></body></html>"
].join("\n");

const deletion = [
  "<!doctype html>",
  '<html lang="en">',
  "<head>",
  '  <meta charset="utf-8">',
  '  <meta name="viewport" content="width=device-width, initial-scale=1">',
  "  <title>Delete account · CloudVault</title>",
  '  <meta name="description" content="Sign in to permanently delete your CloudVault account and associated CloudVault data.">',
  "  <style>",
  "    :root{color-scheme:dark;--bg:#0b1020;--panel:#121a2d;--text:#edf2ff;--muted:#a7b4ca;--line:#2b3952;--accent:#9bb8ff;--danger:#ff8c8c}",
  "    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;padding:20px}",
  "    main{width:min(560px,100%);background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:clamp(20px,5vw,32px);box-shadow:0 24px 80px #0005}",
  "    h1{line-height:1.2;font-size:clamp(1.8rem,6vw,2.5rem);margin:8px 0 12px}p{color:#d0daeb}.muted{color:var(--muted)}label{display:block;margin:16px 0 6px;font-weight:600}",
  "    input{width:100%;background:#0b1222;color:var(--text);border:1px solid var(--line);border-radius:10px;padding:12px;font:inherit}",
  "    button,.link{display:inline-block;margin-top:18px;border-radius:10px;padding:11px 16px;font:inherit;font-weight:700;text-decoration:none;cursor:pointer}",
  "    button{border:1px solid var(--danger);background:#48232b;color:#ffe5e5;width:100%}.secondary{background:#192943;border-color:var(--line);color:var(--text);width:auto}",
  "    .brand{font-size:.8rem;letter-spacing:.12em;font-weight:800;color:var(--accent)}.warning{border:1px solid #79504a;background:#38252a;padding:14px;border-radius:12px}",
  "    .status{margin-top:16px;padding:12px;border-radius:10px;background:#0b1222;color:var(--text);white-space:pre-wrap}.hidden{display:none!important}a{color:var(--accent)}",
  "  </style>",
  "</head>",
  "<body><main>",
  "  <div class='brand'>CLOUDVAULT</div>",
  "  <h1>Delete your CloudVault account</h1>",
  "  <p>This page is available both inside the app and on the web so you can request deletion without opening the app.</p>",
  "  <div class='warning'><strong>What will be deleted:</strong> your CloudVault account, active CloudVault sessions, folder names, folder assignments and Telegram message-index metadata.</div>",
  "  <p><strong>What will not be deleted:</strong> files and messages already stored in your Telegram Saved Messages. Those belong to your Telegram account and must be removed directly in Telegram. CloudVault does not keep a separate copy of those file contents.</p>",
  "  <form id='login-form'>",
  "    <h2>Sign in to continue</h2>",
  "    <label for='email'>CloudVault email</label><input id='email' type='email' autocomplete='username' required>",
  "    <label for='login-password'>CloudVault password</label><input id='login-password' type='password' autocomplete='current-password' required>",
  "    <button class='secondary' type='submit'>Sign in</button>",
  "  </form>",
  "  <section id='delete-panel' class='hidden'>",
  "    <p>Signed in as <strong id='signed-in-email'></strong></p>",
  "    <form id='delete-form'>",
  "      <label for='confirm-password'>Re-enter your CloudVault password</label><input id='confirm-password' type='password' autocomplete='current-password' required>",
  "      <label for='confirm-word'>Type DELETE to confirm</label><input id='confirm-word' type='text' autocomplete='off' required>",
  "      <button type='submit'>Permanently delete my account</button>",
  "    </form>",
  "  </section>",
  "  <div id='status' class='status' role='status' aria-live='polite'>Checking your CloudVault sign-in…</div>",
  "  <p class='muted'><a href='/privacy-policy.html'>Privacy policy</a> · <a href='/'>Return to CloudVault</a></p>",
  "</main>",
  "<script type='module'>",
  "  import { clearLocalAccountData } from '/src/storage.js';",
  "  const statusBox = document.getElementById('status');",
  "  const loginForm = document.getElementById('login-form');",
  "  const deletePanel = document.getElementById('delete-panel');",
  "  const deleteForm = document.getElementById('delete-form');",
  "  const setStatus = (message) => { statusBox.textContent = message; };",
  "  async function api(path, options = {}) {",
  "    const response = await fetch('/api' + path, { ...options, credentials: 'same-origin', cache: 'no-store', headers: { 'Accept': 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });",
  "    let result = {}; try { result = await response.json(); } catch { /* ignore non-JSON responses */ }",
  "    if (!response.ok) throw new Error(result.error || 'Request failed (' + response.status + ').');",
  "    return result;",
  "  }",
  "  function signedIn(user) {",
  "    document.getElementById('signed-in-email').textContent = user.email || 'CloudVault account';",
  "    loginForm.classList.add('hidden'); deletePanel.classList.remove('hidden');",
  "    setStatus('Your identity is verified. Re-enter your password and type DELETE to continue.');",
  "  }",
  "  try { const result = await api('/auth/me'); signedIn(result.user || {}); }",
  "  catch { setStatus('Sign in with your CloudVault email and password to request account deletion.'); }",
  "  loginForm.addEventListener('submit', async (event) => {",
  "    event.preventDefault(); setStatus('Signing in…');",
  "    try { const result = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: document.getElementById('email').value, password: document.getElementById('login-password').value }) }); signedIn(result.user || {}); document.getElementById('login-password').value = ''; }",
  "    catch (error) { setStatus(error.message); }",
  "  });",
  "  deleteForm.addEventListener('submit', async (event) => {",
  "    event.preventDefault();",
  "    const password = document.getElementById('confirm-password').value;",
  "    const word = document.getElementById('confirm-word').value.trim();",
  "    if (word !== 'DELETE') { setStatus('Type DELETE exactly to confirm.'); return; }",
  "    if (!window.confirm('Permanently delete your CloudVault account and its CloudVault data? Telegram Saved Messages files will remain in Telegram.')) return;",
  "    setStatus('Deleting your CloudVault account…');",
  "    try {",
  "      await api('/auth/account', { method: 'DELETE', body: JSON.stringify({ password }) });",
  "      try { await clearLocalAccountData(); } catch { /* the account has already been deleted remotely */ }",
  "      deletePanel.classList.add('hidden');",
  "      setStatus('Your CloudVault account and associated CloudVault database records have been deleted. Your Telegram Saved Messages files were not changed. To remove those files, delete them in Telegram. You can now close this page.');",
  "    } catch (error) { setStatus(error.message); }",
  "  });",
  "</script>",
  "</body></html>"
].join("\n");

fs.writeFileSync(path.join(webDir, "privacy-policy.html"), policy);
fs.writeFileSync(path.join(webDir, "delete-account.html"), deletion);
console.log("Added CloudVault privacy policy and in-app/external account deletion pages.");
