function firstHeaderValue(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .find(Boolean) || '';
}

function normalizeOrigin(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function safeUrl(urlLike) {
  try {
    return new URL(urlLike);
  } catch {
    return null;
  }
}

export function getRequestOrigin(req) {
  const forwardedProto = firstHeaderValue(req.headers['x-forwarded-proto']);
  const forwardedHost = firstHeaderValue(req.headers['x-forwarded-host']);
  const protocol = forwardedProto || req.protocol || 'http';
  const host = forwardedHost || req.get('host') || '';
  if (!host) return '';
  return normalizeOrigin(`${protocol}://${host}`);
}

export function isLoopbackOrigin(origin) {
  const url = safeUrl(origin);
  if (!url) return false;
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
}

export function choosePreferredOrigin(configuredOrigin, requestOrigin) {
  const normalizedConfigured = normalizeOrigin(configuredOrigin);
  const normalizedRequest = normalizeOrigin(requestOrigin);

  if (normalizedRequest && (!normalizedConfigured || isLoopbackOrigin(normalizedConfigured))) {
    return normalizedRequest;
  }

  return normalizedConfigured || normalizedRequest;
}

export function replaceUrlOrigin(urlLike, nextOrigin) {
  const url = safeUrl(urlLike);
  const replacement = safeUrl(nextOrigin);
  if (!url || !replacement) return safeUrl(urlLike);
  url.protocol = replacement.protocol;
  url.username = replacement.username;
  url.password = replacement.password;
  url.host = replacement.host;
  return url;
}

export function sanitizeReturnTo(raw) {
  const value = String(raw || '').trim();
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/';
  }
  return value;
}
