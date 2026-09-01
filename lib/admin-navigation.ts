export interface AdminNavigationItem {
  href: '/admin' | '/admin/scanner-lab';
  label: string;
  kind: 'dashboard' | 'scanner';
}

const items: AdminNavigationItem[] = [
  { href: '/admin', label: 'Admin Dashboard', kind: 'dashboard' },
  { href: '/admin/scanner-lab', label: 'Scanner Lab', kind: 'scanner' },
];

export function adminNavigation(isAdmin: boolean): AdminNavigationItem[] {
  return isAdmin ? items : [];
}
