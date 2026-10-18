/**
 * Site header and footer.
 *
 * The primary navigation lists the full product vision. Destinations that are
 * not built yet are rendered as visibly disabled with an "Soon" marker rather
 * than as links that lead to an empty page, so the navigation never implies a
 * feature works when it does not.
 */

import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../lib/auth-context.tsx';
import { Button, Container } from './ui.tsx';

interface NavItem {
  label: string;
  to: string;
  ready: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Home', to: '/', ready: true },
  { label: 'Discover Businesses', to: '/discover', ready: true },
  { label: 'Products', to: '/products', ready: false },
  { label: 'Services', to: '/services', ready: false },
  { label: 'Buy & Sell', to: '/buy-sell', ready: false },
  { label: 'Business Passport', to: '/passport', ready: true },
  { label: 'AI Business Hub', to: '/ai-hub', ready: false },
  { label: 'AI Employment & Jobs', to: '/jobs', ready: false },
  { label: 'Free Business Resources', to: '/resources', ready: false },
  { label: 'Grants & Startup Benefits', to: '/grants', ready: false },
  { label: 'Global Networking', to: '/networking', ready: false },
  { label: 'Learning & Events', to: '/events', ready: false },
  { label: 'Pricing', to: '/pricing', ready: false },
  { label: 'About', to: '/about', ready: true },
  { label: 'Help & Support', to: '/help', ready: true },
];

export function SiteHeader() {
  const { user, loading, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    setMenuOpen(false);
    navigate('/');
  }

  return (
    <header className="no-print sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
      <Container>
        <div className="flex h-16 items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2.5" aria-label="Universal Business Passport home">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy-900 text-xs font-bold text-gold-300"
            >
              UBP
            </span>
            <span className="hidden flex-col leading-none sm:flex">
              <span className="text-sm font-semibold text-navy-900">Universal Business Passport</span>
              <span className="text-[0.7rem] text-slate-500">by AllCompanies</span>
            </span>
          </Link>

          <nav aria-label="Primary" className="hidden items-center gap-1 xl:flex">
            {NAV_ITEMS.slice(0, 5).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `rounded-md px-2.5 py-2 text-sm font-medium transition-colors ${
                    isActive ? 'bg-navy-50 text-navy-900' : 'text-slate-600 hover:bg-slate-50 hover:text-navy-900'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            {!loading && user ? (
              <>
                <Link
                  to="/dashboard"
                  className="hidden rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-navy-900 sm:block"
                >
                  Dashboard
                </Link>
                <Button tone="secondary" onClick={handleSignOut} className="hidden sm:inline-flex">
                  Sign out
                </Button>
              </>
            ) : (
              <>
                <Link
                  to="/signin"
                  className="hidden rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-navy-900 sm:block"
                >
                  Sign in
                </Link>
                <Link to="/register" className="hidden sm:block">
                  <Button>Register your business</Button>
                </Link>
              </>
            )}

            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
              className="rounded-md p-2 text-slate-600 hover:bg-slate-100 xl:hidden"
            >
              <span className="sr-only">Toggle navigation menu</span>
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="currentColor">
                {menuOpen ? (
                  <path d="M5.3 4.3 10 9l4.7-4.7 1 1L11 10l4.7 4.7-1 1L10 11l-4.7 4.7-1-1L9 10 4.3 5.3z" />
                ) : (
                  <path d="M3 5h14v1.6H3zM3 9.2h14v1.6H3zM3 13.4h14V15H3z" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </Container>

      {menuOpen && (
        <div id="mobile-menu" className="border-t border-slate-200 bg-white xl:hidden">
          <Container className="py-3">
            <nav aria-label="All sections" className="grid gap-0.5 sm:grid-cols-2">
              {NAV_ITEMS.map((item) =>
                item.ready ? (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setMenuOpen(false)}
                    className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {item.label}
                  </NavLink>
                ) : (
                  <span
                    key={item.to}
                    aria-disabled="true"
                    className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-slate-400"
                  >
                    {item.label}
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[0.65rem] font-medium text-slate-500">
                      Phase 2+
                    </span>
                  </span>
                ),
              )}
            </nav>
            <div className="mt-3 flex flex-col gap-2 border-t border-slate-100 pt-3 sm:hidden">
              {user ? (
                <>
                  <Link to="/dashboard" onClick={() => setMenuOpen(false)}>
                    <Button tone="secondary" fullWidth>
                      Dashboard
                    </Button>
                  </Link>
                  <Button tone="ghost" fullWidth onClick={handleSignOut}>
                    Sign out
                  </Button>
                </>
              ) : (
                <>
                  <Link to="/signin" onClick={() => setMenuOpen(false)}>
                    <Button tone="secondary" fullWidth>
                      Sign in
                    </Button>
                  </Link>
                  <Link to="/register" onClick={() => setMenuOpen(false)}>
                    <Button fullWidth>Register your business</Button>
                  </Link>
                </>
              )}
            </div>
          </Container>
        </div>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="no-print mt-16 border-t border-slate-200 bg-white">
      <Container className="py-10">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-sm font-semibold text-navy-900">Universal Business Passport</p>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              One business identity, one digital passport, one global marketplace, one AI business
              toolkit, one free business resource network.
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Platform</p>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>
                <Link to="/discover" className="hover:text-navy-900">
                  Discover businesses
                </Link>
              </li>
              <li>
                <Link to="/passport" className="hover:text-navy-900">
                  Business Passport
                </Link>
              </li>
              <li>
                <Link to="/register" className="hover:text-navy-900">
                  Register your business
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Build status
            </p>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>
                <Link to="/about" className="hover:text-navy-900">
                  About &amp; roadmap
                </Link>
              </li>
              <li>
                <Link to="/help" className="hover:text-navy-900">
                  Help &amp; support
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Important
            </p>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              The Universal Business Passport is a private digital business identity and membership
              credential issued by AllCompanies. It is not a government-issued passport, a statutory
              licence, a bank card, a credit facility, or a government endorsement. Verification
              levels describe specific checks performed; they are not a guarantee of solvency,
              trustworthiness or regulatory compliance.
            </p>
          </div>
        </div>
        <p className="mt-8 border-t border-slate-100 pt-6 text-xs text-slate-400">
          Universal Business Passport, powered by AllCompanies.
        </p>
      </Container>
    </footer>
  );
}
