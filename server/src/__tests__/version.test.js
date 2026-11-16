import { describe, expect, it } from 'vitest';
import { compareVersions, isNativeBuildSupported, isVersionSupported } from '../version.js';

describe('Version Comparison & Policy Enforcement', () => {
  it('correctly compares semantic versions', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.1', '1.0.0')).toBe(1);
    expect(compareVersions('1.1.0', '1.0.9')).toBe(1);
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1);
    expect(compareVersions('0.9.9', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
  });

  it('validates supported versions against minimum supported version', () => {
    expect(isVersionSupported('1.0.0', '1.0.0')).toBe(true);
    expect(isVersionSupported('1.1.0', '1.0.0')).toBe(true);
    expect(isVersionSupported('0.9.9', '1.0.0')).toBe(false);
    expect(isVersionSupported(null, '1.0.0')).toBe(true); // unversioned
  });

  it('validates native build numbers', () => {
    expect(isNativeBuildSupported(1, 1)).toBe(true);
    expect(isNativeBuildSupported(2, 1)).toBe(true);
    expect(isNativeBuildSupported('2', 1)).toBe(true);
    expect(isNativeBuildSupported(0, 1)).toBe(false);
    expect(isNativeBuildSupported(null, 1)).toBe(true); // null build allowed for web
  });
});
