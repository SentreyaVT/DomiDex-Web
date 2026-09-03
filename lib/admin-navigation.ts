export interface AdminNavigationItem {
  href: '/admin' | '/admin/scanner-lab' | '/admin/testers';
  label: string;
  kind: 'dashboard' | 'scanner' | 'testers';
}

const items: AdminNavigationItem[] = [
  { href: '/admin', label: 'Admin Dashboard', kind: 'dashboard' },
  { href: '/admin/scanner-lab', label: 'Scanner Lab', kind: 'scanner' },
  { href: '/admin/testers', label: 'Tester & Berechtigungen', kind: 'testers' },
];

export function adminNavigation(isAdmin: boolean): AdminNavigationItem[] {
  return isAdmin ? items : [];
}
