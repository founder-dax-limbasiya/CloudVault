import { createClient } from "npm:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
const secretKeys = secretKeysRaw ? JSON.parse(secretKeysRaw) : {};
const adminKey = secretKeys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
if (!url || !adminKey) throw new Error("Supabase server credentials are not available.");

const db = createClient(url, adminKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const encoder = new TextEncoder();
const SESSION_DAYS = 30;
const COOKIE_NAME = "cv_session";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MESSAGE_RE = /^[0-9]{1,20}$/;

function json(data: unknown, status = 200, extra: HeadersInit = {}) {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(data), { status, headers });
}

function responseError(message: string, status = 400) {
  return json({ error: message }, status);
}

function getCookie(req: Request, name: string) {
  const raw = req.headers.get("cookie") ?? "";
  const value = raw.split(";").map((part) => part.trim()).find((part) => part.startsWith(name + "="));
  if (!value) return "";
  try { return decodeURIComponent(value.slice(name.length + 1)); } catch { return ""; }
}

function makeCookie(token: string) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`;
}

function expiredCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string) {
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

async function derivePassword(password: string, saltHex: string) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: fromHex(saltHex), iterations: 310000, hash: "SHA-256" },
    material,
    512,
  );
  return hex(new Uint8Array(derived));
}

async function hashPassword(password: string) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, hash: `pbkdf2$310000$${await derivePassword(password, salt)}` };
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyPassword(password: string, salt: string, stored: string) {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "pbkdf2" || parts[1] !== "310000") return false;
  const actual = await derivePassword(password, salt);
  return constantTimeEqual(actual, parts[2]);
}

async function readBody(req: Request) {
  const raw = await req.text();
  if (raw.length > 16384) throw new Error("Request too large.");
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error("Invalid JSON request."); }
}

function cleanFolderName(value: unknown) {
  const name = String(value ?? "").trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= 60 ? name : "";
}

async function createSession(req: Request, user: { id: string }) {
  const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const deviceName = (req.headers.get("x-device-name") || "Web browser").slice(0, 100);
  const userAgent = (req.headers.get("user-agent") || "").slice(0, 400);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  const { error } = await db.from("cv_sessions").insert({
    user_id: user.id,
    token_hash: await sha256(token),
    device_name: deviceName,
    user_agent: userAgent,
    expires_at: expiresAt,
  });
  if (error) throw error;
  return makeCookie(token);
}

async function currentSession(req: Request) {
  const token = getCookie(req, COOKIE_NAME);
  if (!token) return null;
  const { data: session, error } = await db.from("cv_sessions")
    .select("id,user_id,expires_at")
    .eq("token_hash", await sha256(token))
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  if (!session) return null;
  const { data: user, error: userError } = await db.from("cv_users")
    .select("id,email,display_name")
    .eq("id", session.user_id)
    .maybeSingle();
  if (userError) throw userError;
  if (!user) return null;
  const { error: updateError } = await db.from("cv_sessions")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", session.id);
  if (updateError) throw updateError;
  return { session_id: session.id, user_id: user.id, email: user.email, display_name: user.display_name };
}

function fetchPath(req: Request) {
  const pathname = new URL(req.url).pathname;
  const marker = "/cloudvault-api";
  const index = pathname.indexOf(marker);
  return index >= 0 ? pathname.slice(index + marker.length) || "/api/health" : pathname;
}

async function handle(req: Request) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });

  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site" && fetchSite !== "none") {
    return responseError("Cross-site request blocked.", 403);
  }

  const path = fetchPath(req);
  if (!path.startsWith("/api/")) return responseError("Not found.", 404);

  if (req.method === "GET" && path === "/api/health") {
    const { error } = await db.from("cv_users").select("id", { count: "exact", head: true });
    if (error) throw error;
    return json({ ok: true, service: "cloudvault", database: "connected" });
  }

  if (req.method === "POST" && path === "/api/auth/register") {
    const data = await readBody(req);
    const email = String(data.email ?? "").trim().toLowerCase();
    const password = String(data.password ?? "");
    if (!EMAIL_RE.test(email)) return responseError("Enter a valid email address.");
    if (password.length < 10 || password.length > 200) return responseError("Password must be 10–200 characters.");
    const { salt, hash } = await hashPassword(password);
    const { data: user, error } = await db.from("cv_users")
      .insert({ email, display_name: String(data.displayName ?? "").trim().slice(0, 80), password_salt: salt, password_hash: hash })
      .select("id,email,display_name")
      .single();
    if (error?.code === "23505") return responseError("An account with this email already exists.", 409);
    if (error) throw error;
    const cookie = await createSession(req, user);
    return json({ user }, 201, { "set-cookie": cookie });
  }

  if (req.method === "POST" && path === "/api/auth/login") {
    const data = await readBody(req);
    const email = String(data.email ?? "").trim().toLowerCase();
    const { data: user, error } = await db.from("cv_users")
      .select("id,email,display_name,password_salt,password_hash")
      .eq("email", email)
      .maybeSingle();
    if (error) throw error;
    if (!user || !(await verifyPassword(String(data.password ?? ""), user.password_salt, user.password_hash))) {
      return responseError("Email or password is incorrect.", 401);
    }
    const cookie = await createSession(req, user);
    return json({ user: { id: user.id, email: user.email, display_name: user.display_name } }, 200, { "set-cookie": cookie });
  }

  if (req.method === "GET" && path === "/api/auth/me") {
    const session = await currentSession(req);
    return session
      ? json({ user: { id: session.user_id, email: session.email, display_name: session.display_name } })
      : responseError("Please sign in.", 401);
  }

  if (req.method === "DELETE" && path === "/api/auth/account") {
    const session = await currentSession(req);
    if (!session) return responseError("Please sign in.", 401);
    const data = await readBody(req);
    const password = String(data.password ?? "");
    if (!password || password.length > 200) return responseError("Enter your CloudVault password to confirm deletion.");
    const { data: user, error: userError } = await db.from("cv_users")
      .select("password_salt,password_hash")
      .eq("id", session.user_id)
      .maybeSingle();
    if (userError) throw userError;
    if (!user || !(await verifyPassword(password, user.password_salt, user.password_hash))) {
      return responseError("CloudVault password is incorrect.", 401);
    }
    // Related CloudVault sessions, folders, password-reset rows and message-index metadata cascade on user deletion.
    // Telegram Saved Messages content is not stored here and is intentionally left untouched.
    const { error: deleteError } = await db.from("cv_users").delete().eq("id", session.user_id);
    if (deleteError) throw deleteError;
    return json({ ok: true, deleted: true, telegramMessagesDeleted: false }, 200, { "set-cookie": expiredCookie() });
  }

  if (req.method === "POST" && path === "/api/auth/logout") {
    const token = getCookie(req, COOKIE_NAME);
    if (token) {
      const { error } = await db.from("cv_sessions").delete().eq("token_hash", await sha256(token));
      if (error) throw error;
    }
    return json({ ok: true }, 200, { "set-cookie": expiredCookie() });
  }

  if (req.method === "GET" && path === "/api/auth/devices") {
    const session = await currentSession(req);
    if (!session) return responseError("Please sign in.", 401);
    const { data, error } = await db.from("cv_sessions")
      .select("id,device_name,user_agent,created_at,last_seen_at")
      .eq("user_id", session.user_id)
      .gt("expires_at", new Date().toISOString())
      .order("last_seen_at", { ascending: false });
    if (error) throw error;
    return json({ devices: (data ?? []).map((item) => ({ ...item, current: item.id === session.session_id })) });
  }

  if (req.method === "DELETE" && path.startsWith("/api/auth/devices/")) {
    const session = await currentSession(req);
    if (!session) return responseError("Please sign in.", 401);
    const id = path.split("/").pop() ?? "";
    if (!UUID_RE.test(id)) return responseError("Invalid device id.");
    const { error } = await db.from("cv_sessions").delete().eq("id", id).eq("user_id", session.user_id);
    if (error) throw error;
    return json({ ok: true });
  }

  if (req.method === "GET" && path === "/api/vault/folders") {
    const session = await currentSession(req);
    if (!session) return responseError("Please sign in.", 401);
    const [folders, assignments] = await Promise.all([
      db.from("cv_folders").select("id,name,created_at,updated_at").eq("user_id", session.user_id).order("created_at"),
      db.from("cv_file_assignments").select("telegram_message_id,folder_id").eq("user_id", session.user_id),
    ]);
    if (folders.error) throw folders.error;
    if (assignments.error) throw assignments.error;
    return json({
      folders: folders.data ?? [],
      assignments: Object.fromEntries((assignments.data ?? []).map((row) => [row.telegram_message_id, row.folder_id])),
    });
  }

  if (req.method === "POST" && path === "/api/vault/folders") {
    const session = await currentSession(req);
    if (!session) return responseError("Please sign in.", 401);
    const data = await readBody(req);
    const name = cleanFolderName(data.name);
    if (!name) return responseError("Folder names must be between 1 and 60 characters.");
    const { data: folder, error } = await db.from("cv_folders")
      .insert({ user_id: session.user_id, name })
      .select("id,name,created_at,updated_at")
      .single();
    if (error?.code === "23505") return responseError("A folder with that name already exists.", 409);
    if (error) throw error;
    return json({ folder }, 201);
  }

  if (req.method === "PATCH" && path.startsWith("/api/vault/folders/")) {
    const session = await currentSession(req);
    if (!session) return responseError("Please sign in.", 401);
    const id = path.split("/").pop() ?? "";
    if (!UUID_RE.test(id)) return responseError("Invalid folder ID.");
    const data = await readBody(req);
    const name = cleanFolderName(data.name);
    if (!name) return responseError("Folder names must be between 1 and 60 characters.");
    const { data: folder, error } = await db.from("cv_folders")
      .update({ name, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", session.user_id)
      .select("id,name,created_at,updated_at")
      .maybeSingle();
    if (error?.code === "23505") return responseError("A folder with that name already exists.", 409);
    if (error) throw error;
    if (!folder) return responseError("Folder not found.", 404);
    return json({ folder });
  }

  if (req.method === "DELETE" && path.startsWith("/api/vault/folders/")) {
    const session = await currentSession(req);
    if (!session) return responseError("Please sign in.", 401);
    const id = path.split("/").pop() ?? "";
    if (!UUID_RE.test(id)) return responseError("Invalid folder ID.");
    const { error } = await db.from("cv_folders").delete().eq("id", id).eq("user_id", session.user_id);
    if (error) throw error;
    return json({ ok: true });
  }

  if (req.method === "PUT" && path.startsWith("/api/vault/assignments/")) {
    const session = await currentSession(req);
    if (!session) return responseError("Please sign in.", 401);
    const messageId = path.split("/").pop() ?? "";
    if (!MESSAGE_RE.test(messageId)) return responseError("Invalid Telegram message ID.");
    const data = await readBody(req);
    const folderId = data.folderId == null || data.folderId === "" ? null : String(data.folderId);
    if (!folderId) {
      const { error } = await db.from("cv_file_assignments").delete()
        .eq("user_id", session.user_id).eq("telegram_message_id", messageId);
      if (error) throw error;
      return json({ ok: true, folderId: null });
    }
    if (!UUID_RE.test(folderId)) return responseError("Invalid folder ID.");
    const { data: folder, error: folderError } = await db.from("cv_folders")
      .select("id").eq("id", folderId).eq("user_id", session.user_id).maybeSingle();
    if (folderError) throw folderError;
    if (!folder) return responseError("Folder not found.", 404);
    const { error } = await db.from("cv_file_assignments").upsert({
      user_id: session.user_id, telegram_message_id: messageId, folder_id: folderId, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,telegram_message_id" });
    if (error) throw error;
    return json({ ok: true, folderId });
  }

  if (req.method === "POST" && (path === "/api/auth/forgot-password" || path === "/api/auth/reset-password")) {
    return responseError("Password-reset email is not configured on this CloudVault deployment.", 503);
  }

  return responseError("Not found.", 404);
}

Deno.serve(async (req: Request) => {
  try {
    return await handle(req);
  } catch (error) {
    console.error("CloudVault API request failed:", error instanceof Error ? error.message : "Unknown error");
    return responseError("Something went wrong. Please try again.", 500);
  }
});
