import { NextRequest, NextResponse } from "next/server";

const ACCESS_TOKEN_COOKIE = "mc-access-token";
const REFRESH_TOKEN_COOKIE = "mc-refresh-token";

const publicPrefixes = [
  "/_next",
  "/login",
  "/reports/share",
  "/api/auth",
  "/api/health",
  "/api/jobs",
  "/api/webhooks/registrations",
  "/api/webhooks/sendgrid",
  "/api/webhooks/quickbooks",
  "/api/reports/share",
  "/api/integrations/google/callback",
  "/api/integrations/quickbooks/callback"
];

const publicFiles = ["/favicon.ico", "/robots.txt", "/sitemap.xml"];

function isPublicPath(pathname: string) {
  return publicFiles.includes(pathname) || publicPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function unauthorized(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        success: false,
        error: {
          message: "Authentication required",
          code: "AUTH_REQUIRED"
        }
      },
      { status: 401 }
    );
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

function setAuthCookies(response: NextResponse, accessToken: string, refreshToken: string, expiresIn: number) {
  const secure = process.env.NODE_ENV === "production";
  response.cookies.set(ACCESS_TOKEN_COOKIE, accessToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: expiresIn
  });
  response.cookies.set(REFRESH_TOKEN_COOKIE, refreshToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });
}

async function getMissionControlUser(accessToken: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    return null;
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    return null;
  }

  const user = await response.json();
  return user?.app_metadata?.mission_control === true ? user : null;
}

async function refreshSession(refreshToken: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    return null;
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      "content-type": "application/json"
    },
    body: JSON.stringify({ refresh_token: refreshToken })
  });

  if (!response.ok) {
    return null;
  }

  return response.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number }>;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;

  if (accessToken && await getMissionControlUser(accessToken)) {
    return NextResponse.next();
  }

  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;

  if (refreshToken) {
    const refreshed = await refreshSession(refreshToken);

    if (refreshed && await getMissionControlUser(refreshed.access_token)) {
      const response = NextResponse.next();
      setAuthCookies(response, refreshed.access_token, refreshed.refresh_token, refreshed.expires_in);
      return response;
    }
  }

  return unauthorized(request);
}

export const config = {
  matcher: ["/((?!.*\\..*).*)"]
};
