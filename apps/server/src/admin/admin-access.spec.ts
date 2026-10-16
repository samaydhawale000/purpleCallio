import { cleanPermissions, resolvePermissions, tabForPath } from './admin-access';

describe('admin-access', () => {
  it('maps API paths to admin tabs', () => {
    expect(tabForPath('/admin/billing/plans/abc')).toBe('billing');
    expect(tabForPath('/admin/billing/customers/u1/credits')).toBe('customers');
    expect(tabForPath('/admin/customers?page=2')).toBe('customers');
    expect(tabForPath('/admin/support/tickets/t1/messages')).toBe('support');
    expect(tabForPath('/admin/monitoring')).toBe('health');
    expect(tabForPath('/admin/admins/x')).toBe('admins');
    expect(tabForPath('/admin/overview')).toBeNull();
    expect(tabForPath('/admin/me')).toBeNull();
  });

  it('treats null permissions as full access and drops unknown values', () => {
    expect(resolvePermissions(null).billing).toBe('WRITE');
    expect(cleanPermissions({ billing: 'READ', support: 'ADMIN', bogus: 'WRITE' })).toEqual({ billing: 'READ' });
  });
});
