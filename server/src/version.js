import { config } from './config.js';

/**
 * Compare two semver strings: a and b.
 * Returns:
 *   1 if a > b
 *  -1 if a < b
 *   0 if a === b
 */
export function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/**
 * Checks if a client version is supported by the server.
 */
export function isVersionSupported(clientVersion, minSupportedVersion = config.minSupportedVersion) {
  if (!clientVersion) return true; // Unversioned requests are allowed to prevent unexpected breaks
  return compareVersions(clientVersion, minSupportedVersion) >= 0;
}

/**
 * Checks if a native build number is supported.
 */
export function isNativeBuildSupported(nativeBuild, minSupportedBuild = config.minSupportedNativeBuild) {
  if (nativeBuild == null) return true;
  const parsed = parseInt(nativeBuild, 10);
  if (isNaN(parsed)) return true;
  return parsed >= minSupportedBuild;
}
