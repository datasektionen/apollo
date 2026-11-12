import { describe, expect, it } from 'vitest';
import { sanitizeReturnTo } from '../requestOrigin.js';

describe('sanitizeReturnTo', () => {
  it('allows safe local relative paths', () => {
    expect(sanitizeReturnTo('/daw/projects/proj-123')).toBe('/daw/projects/proj-123');
    expect(sanitizeReturnTo('/player/shows/show-1?play=song-2')).toBe('/player/shows/show-1?play=song-2');
    expect(sanitizeReturnTo('/admin/roles')).toBe('/admin/roles');
    expect(sanitizeReturnTo('/admin/roles/role-456')).toBe('/admin/roles/role-456');
  });

  it('rejects external URLs and open-redirect vectors', () => {
    expect(sanitizeReturnTo('http://evil.com')).toBe('/');
    expect(sanitizeReturnTo('https://evil.com/login')).toBe('/');
    expect(sanitizeReturnTo('//evil.com')).toBe('/');
    expect(sanitizeReturnTo('/\\evil.com')).toBe('/');
    expect(sanitizeReturnTo('javascript:alert(1)')).toBe('/');
    expect(sanitizeReturnTo('')).toBe('/');
    expect(sanitizeReturnTo(null)).toBe('/');
    expect(sanitizeReturnTo(undefined)).toBe('/');
  });
});
