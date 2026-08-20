import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(path.join(__dirname, '..', '..'));

// Load the shared root .env for direct local runs; shell env still overrides file values.
dotenv.config({ path: path.join(projectRoot, '.env') });

actionValidate();

function firstDefined(...values) {
  return values.find((value) => value != null && String(value).trim() !== '');
}

function parseBoolean(value, fallback = false) {
  const normalized = String(firstDefined(value, fallback ? 'true' : 'false')).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function buildDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const protocol = 'postgres';
  const user = 'apollo';
  const password = 'apollo';
  const host = 'localhost';
  const port = firstDefined(process.env.DB_PORT, '5432');
  const name = 'apollo';

  if (!user || !password || !host || !name) return null;
  return `${protocol}://${user}:${password}@${host}:${port}/${name}`;
}

function buildOidcIssuer() {
  const explicitIssuer = firstDefined(process.env.OIDC_ISSUER);
  if (explicitIssuer) return explicitIssuer;

  const mockPort = firstDefined(process.env.OIDC_MOCK_PORT, '9400');
  return `http://localhost:${mockPort}`;
}

function buildOidcMockIssuerCandidates() {
  const mockPort = firstDefined(process.env.OIDC_MOCK_PORT, '9400');
  return [
    `http://localhost:${mockPort}`,
    `http://oidc-mock:${mockPort}`,
  ];
}

function buildOidcPublicIssuer(oidcIssuer) {
  return firstDefined(
    process.env.OIDC_PUBLIC_ISSUER,
    oidcIssuer
  ) || '';
}

function allowsInsecureOidcIssuer(oidcIssuer) {
  return buildOidcMockIssuerCandidates().includes(String(oidcIssuer || '').trim());
}

function normalizeOrigin(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function buildPublicBaseUrl() {
  return normalizeOrigin(process.env.PUBLIC_BASE_URL);
}

function buildOidcRedirectUri() {
  return firstDefined(process.env.OIDC_REDIRECT_URI) || '';
}

function buildOidcPostLogoutRedirectUri() {
  return firstDefined(process.env.OIDC_POST_LOGOUT_REDIRECT_URI) || '';
}

function resolveMediaRoot() {
  if (fs.existsSync('/.dockerenv')) {
    return '/data/media';
  }

  const configured = firstDefined(process.env.ABSOLUTE_MEDIA_ROOT);
  if (configured) {
    if (!path.isAbsolute(configured)) {
      throw new Error('ABSOLUTE_MEDIA_ROOT must be an absolute path when set');
    }
    return configured;
  }

  return path.resolve(path.join(__dirname, '..', 'media'));
}

function validateDockerMediaRootSource() {
  const configured = firstDefined(process.env.ABSOLUTE_MEDIA_ROOT);
  if (configured && !path.isAbsolute(configured)) {
    throw new Error('ABSOLUTE_MEDIA_ROOT must be an absolute host path when used with Docker');
  }
}

function actionValidate() {
  const databaseUrl = buildDatabaseUrl();
  if (databaseUrl) {
    process.env.DATABASE_URL = databaseUrl;
  }

  validateDockerMediaRootSource();

  const required = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const oidcIssuer = buildOidcIssuer();
  const oidcRequired = {
    OIDC_ISSUER: oidcIssuer,
    OIDC_CLIENT_ID: process.env.OIDC_CLIENT_ID,
  };
  const oidcMissing = Object.entries(oidcRequired)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (oidcMissing.length > 0) {
    throw new Error(`Missing required OIDC environment variables: ${oidcMissing.join(', ')}`);
  }
}

function parseHour(value, fallback) {
  const hour = Number(firstDefined(value, fallback));
  if (!Number.isFinite(hour)) return fallback;
  const truncated = Math.trunc(hour);
  if (truncated < 0 || truncated > 23) return fallback;
  return truncated;
}

const mediaRoot = resolveMediaRoot();
const oidcIssuer = buildOidcIssuer();
const oidcPublicIssuer = buildOidcPublicIssuer(oidcIssuer);
const publicBaseUrl = buildPublicBaseUrl();

export const config = {
  port: Number(process.env.API_PORT || 8787),
  publicBaseUrl,
  databaseUrl: process.env.DATABASE_URL,
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '15m',
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS || 7),
  mediaRoot,
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 524288000),
  lockTimeoutSeconds: Number(process.env.RECORD_LOCK_TIMEOUT_SECONDS || 30),
  checkpointEveryOps: Number(process.env.CHECKPOINT_EVERY_OPS || 100),
  checkpointEverySeconds: Number(process.env.CHECKPOINT_EVERY_SECONDS || 30),
  mediaGcTtlHours: Math.max(1, Number(process.env.MEDIA_GC_TTL_HOURS || 168)),
  mediaGcHour: parseHour(process.env.MEDIA_GC_HOUR, 4),
  mediaGcAttachGraceSeconds: Math.max(0, Number(process.env.MEDIA_GC_ATTACH_GRACE_SECONDS || 3600)),
  cookieSecure: parseBoolean(process.env.COOKIE_SECURE, false),
  oidcIssuer,
  oidcPublicIssuer,
  oidcClientId: process.env.OIDC_CLIENT_ID || '',
  oidcClientSecret: process.env.OIDC_CLIENT_SECRET || '',
  oidcUsePkce: parseBoolean(process.env.OIDC_USE_PKCE, true),
  oidcRedirectUri: buildOidcRedirectUri(),
  oidcScopes: process.env.OIDC_SCOPES || 'openid profile email',
  oidcPostLogoutRedirectUri: buildOidcPostLogoutRedirectUri(),
  oidcAllowInsecureHttp: allowsInsecureOidcIssuer(oidcIssuer),
  oidcFirstAdminClaim: firstDefined(process.env.OIDC_FIRST_ADMIN_CLAIM) || '',
};
