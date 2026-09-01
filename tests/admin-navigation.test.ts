import { describe, expect, it } from 'vitest';
import { adminNavigation } from '../lib/admin-navigation';

describe('admin navigation', () => {
  it('is completely absent for normal users', () => {
    expect(adminNavigation(false)).toEqual([]);
  });

  it('offers dashboard and scanner lab only to admins', () => {
    expect(adminNavigation(true).map((item) => item.href)).toEqual(['/admin', '/admin/scanner-lab']);
  });
});
