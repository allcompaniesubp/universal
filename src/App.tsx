/**
 * Application shell and routing.
 *
 * A skip link is the first focusable element so keyboard users can bypass the
 * navigation. Route changes move focus to the main region and update the
 * document title, which screen-reader users rely on to know the page changed.
 */

import { useEffect, useRef } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth-context.tsx';
import { SiteFooter, SiteHeader } from './components/layout.tsx';
import { HomePage } from './pages/home.tsx';
import { RegisterPage, SignInPage, VerifyEmailPage } from './pages/auth.tsx';
import { BusinessFormPage, BusinessPassportPage, DashboardPage } from './pages/dashboard.tsx';
import { PublicBusinessPage, VerifyPage } from './pages/public-business.tsx';
import { DiscoverPage } from './pages/discover.tsx';
import { AboutPage, HelpPage, PassportPage, PhasePlaceholderPage } from './pages/static-pages.tsx';
import { Alert, Button, Container } from './components/ui.tsx';

/** Titles for routes that do not set their own. */
const ROUTE_TITLES: Record<string, string> = {
  '/': 'Universal Business Passport — one business identity, one global marketplace',
  '/discover': 'Discover businesses — Universal Business Passport',
  '/passport': 'What the Universal Business Passport is',
  '/about': 'About and build status — Universal Business Passport',
  '/help': 'Help and support — Universal Business Passport',
  '/register': 'Register your business — Universal Business Passport',
  '/signin': 'Sign in — Universal Business Passport',
  '/dashboard': 'Dashboard — Universal Business Passport',
  '/verify': 'Verify a business passport — Universal Business Passport',
  '/products': 'Products — Universal Business Passport',
  '/services': 'Services — Universal Business Passport',
  '/buy-sell': 'Buy and sell — Universal Business Passport',
  '/ai-hub': 'AI Business Hub — Universal Business Passport',
  '/jobs': 'AI Employment and Jobs — Universal Business Passport',
  '/resources': 'Free business resources — Universal Business Passport',
  '/grants': 'Grants and startup benefits — Universal Business Passport',
  '/networking': 'Global networking — Universal Business Passport',
  '/events': 'Learning and events — Universal Business Passport',
  '/pricing': 'Pricing — Universal Business Passport',
};

function NotFoundPage() {
  return (
    <Container className="py-20">
      <div className="mx-auto max-w-lg text-center">
        <p className="text-sm font-semibold text-navy-700">404</p>
        <h1 className="mt-2 text-2xl font-semibold">This page does not exist</h1>
        <p className="mt-3 text-sm text-slate-600">
          The address you followed does not match a page on this site.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link to="/">
            <Button>Go to the homepage</Button>
          </Link>
          <Link to="/discover">
            <Button tone="secondary">Browse businesses</Button>
          </Link>
        </div>
      </div>
    </Container>
  );
}

/**
 * Per-route document title and focus management.
 *
 * A single-page app does not fire a page-load event on navigation, so the title
 * and focus are set explicitly here.
 */
function RouteAnnouncer() {
  const location = useLocation();
  const previousPath = useRef(location.pathname);

  useEffect(() => {
    if (previousPath.current === location.pathname) return;
    previousPath.current = location.pathname;

    const title = ROUTE_TITLES[location.pathname];
    if (title) {
      document.title = title;
    } else if (location.pathname.startsWith('/business/')) {
      document.title = 'Business profile — Universal Business Passport';
    } else if (location.pathname.startsWith('/verify/')) {
      document.title = 'Passport verification — Universal Business Passport';
    } else if (location.pathname.startsWith('/businesses/')) {
      document.title = 'Manage business — Universal Business Passport';
    } else if (location.pathname === '/verify-email') {
      document.title = 'Confirm your email — Universal Business Passport';
    } else {
      document.title = 'Universal Business Passport';
    }

    const main = document.getElementById('main-content');
    if (main) main.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  return null;
}

/** Shown when the API is unreachable, so a blank page never appears. */
function ApiUnavailableBanner() {
  const { config, loading } = useAuth();
  if (loading || config) return null;
  return (
    <Container className="pt-4">
      <Alert tone="warning" title="Server unavailable">
        The platform could not reach its API, so live data such as the business directory is not
        available. This usually means the API service is not running or its database is not
        configured.
      </Alert>
    </Container>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/discover" element={<DiscoverPage />} />
      <Route path="/passport" element={<PassportPage />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/help" element={<HelpPage />} />

      <Route path="/register" element={<RegisterPage />} />
      <Route path="/signin" element={<SignInPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />

      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/businesses/new" element={<BusinessFormPage mode="create" />} />
      <Route path="/businesses/:id/edit" element={<BusinessFormPage mode="edit" />} />
      <Route path="/businesses/:id/passport" element={<BusinessPassportPage />} />

      <Route path="/business/:slug" element={<PublicBusinessPage />} />
      <Route path="/verify" element={<VerifyPage />} />
      <Route path="/verify/:ubpId" element={<VerifyPage />} />

      <Route path="/products" element={<PhasePlaceholderPage feature="products" />} />
      <Route path="/services" element={<PhasePlaceholderPage feature="services" />} />
      <Route path="/buy-sell" element={<PhasePlaceholderPage feature="buy-sell" />} />
      <Route path="/ai-hub" element={<PhasePlaceholderPage feature="ai-hub" />} />
      <Route path="/jobs" element={<PhasePlaceholderPage feature="jobs" />} />
      <Route path="/resources" element={<PhasePlaceholderPage feature="resources" />} />
      <Route path="/grants" element={<PhasePlaceholderPage feature="grants" />} />
      <Route path="/networking" element={<PhasePlaceholderPage feature="networking" />} />
      <Route path="/events" element={<PhasePlaceholderPage feature="events" />} />
      <Route path="/pricing" element={<PhasePlaceholderPage feature="pricing" />} />

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-navy-900 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to main content
      </a>
      <div className="flex min-h-screen flex-col">
        <SiteHeader />
        <ApiUnavailableBanner />
        <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
          <RouteAnnouncer />
          <AppRoutes />
        </main>
        <SiteFooter />
      </div>
    </AuthProvider>
  );
}
