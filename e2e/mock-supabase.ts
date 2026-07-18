import { createHmac, createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";

// Minimal GoTrue (Supabase Auth) mock for e2e runs — implements just the
// endpoints the app touches (signup, password/refresh token grants, user
// lookup, logout), always auto-confirms, and issues HS256 JWTs. This is
// test infrastructure only; the app is unchanged and simply pointed at it
// via NEXT_PUBLIC_SUPABASE_URL. Never deploy it anywhere.

const PORT = Number(process.env.MOCK_SUPABASE_PORT ?? 54321);
const JWT_SECRET = "e2e-jwt-secret";
const refreshTokens = new Map<string, string>(); // refresh_token -> email

// Deterministic UUID per email so re-runs hit the same users row.
function userIdFor(email: string): string {
  const hex = createHash("sha256").update(email).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function makeJwt(email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      sub: userIdFor(email),
      email,
      aud: "authenticated",
      role: "authenticated",
      iat: now,
      exp: now + 3600,
      session_id: randomUUID(),
    })
  );
  const signature = createHmac("sha256", JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function userFor(email: string) {
  const now = new Date().toISOString();
  return {
    id: userIdFor(email),
    aud: "authenticated",
    role: "authenticated",
    email,
    email_confirmed_at: now,
    confirmed_at: now,
    last_sign_in_at: now,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    created_at: now,
    updated_at: now,
    is_anonymous: false,
  };
}

function session(email: string) {
  const refreshToken = randomUUID();
  refreshTokens.set(refreshToken, email);
  return {
    access_token: makeJwt(email),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: refreshToken,
    user: userFor(email),
  };
}

function emailFromBearer(auth: string | undefined): string | null {
  const token = auth?.replace(/^Bearer /, "");
  if (!token) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString()
    ) as { email?: string; exp?: number };
    if (!payload.email || (payload.exp ?? 0) < Date.now() / 1000) return null;
    return payload.email;
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const headers = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, headers).end();
    return;
  }

  let body: Record<string, unknown> = {};
  if (req.method === "POST") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    try {
      body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    } catch {
      body = {};
    }
  }

  const send = (status: number, payload: unknown) =>
    res.writeHead(status, headers).end(JSON.stringify(payload));

  if (url.pathname === "/health") {
    send(200, { ok: true });
  } else if (req.method === "POST" && url.pathname === "/auth/v1/signup") {
    send(200, session(String(body.email)));
  } else if (req.method === "POST" && url.pathname === "/auth/v1/token") {
    const grant = url.searchParams.get("grant_type");
    if (grant === "password") {
      send(200, session(String(body.email)));
    } else if (grant === "refresh_token") {
      const email = refreshTokens.get(String(body.refresh_token));
      if (email) send(200, session(email));
      else send(400, { error: "invalid_grant", error_description: "unknown refresh token" });
    } else {
      send(400, { error: "unsupported_grant_type" });
    }
  } else if (req.method === "GET" && url.pathname === "/auth/v1/user") {
    const email = emailFromBearer(req.headers.authorization);
    if (email) send(200, userFor(email));
    else send(401, { message: "invalid token" });
  } else if (req.method === "POST" && url.pathname === "/auth/v1/logout") {
    res.writeHead(204, headers).end();
  } else {
    send(404, { message: `mock-supabase: no handler for ${req.method} ${url.pathname}` });
  }
});

server.listen(PORT, () => {
  console.log(`mock-supabase listening on http://127.0.0.1:${PORT}`);
});
