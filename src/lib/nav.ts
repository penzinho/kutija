export type NavItem = { label: string; href: string; active: boolean };

/** Main sections, shared by the header, footer and mobile tab bar. */
export function navItems(pathname: string): NavItem[] {
  const path = pathname.replace(/\/$/, '') || '/';
  return [
    { label: 'Radovi', href: '/', active: path === '/' || path.startsWith('/rad/') },
    { label: 'Dvoboj', href: '/dvoboj', active: path === '/dvoboj' },
    { label: 'Rang', href: '/rang', active: path === '/rang' },
    { label: 'O projektu', href: '/o-projektu', active: path === '/o-projektu' },
  ];
}
