/**
 * Business directory with search, category filter and pagination.
 *
 * Results come from the server; filtering is performed in SQL, not by slicing an
 * already-downloaded array, so pagination counts stay correct.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError, type DirectoryResponse } from '../lib/api.ts';
import { Alert, Button, Card, Container, EmptyState, Spinner, inputClass } from '../components/ui.tsx';
import { locationLabel } from '../lib/format.ts';

export function DiscoverPage() {
  const [params, setParams] = useSearchParams();
  const [result, setResult] = useState<DirectoryResponse | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const search = params.get('search') ?? '';
  const country = params.get('country') ?? '';
  const category = params.get('category') ?? '';
  const page = Number(params.get('page') ?? '1');

  const [searchDraft, setSearchDraft] = useState(search);
  const [countryDraft, setCountryDraft] = useState(country);

  useEffect(() => {
    setSearchDraft(search);
    setCountryDraft(country);
  }, [search, country]);

  useEffect(() => {
    api
      .directoryCategories()
      .then((response) => setCategories(response.categories))
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .directory({
        search: search || undefined,
        country: country || undefined,
        category: category || undefined,
        page,
      })
      .then((response) => {
        if (!cancelled) setResult(response);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof ApiError ? caught.message : 'Could not load the directory.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [search, country, category, page]);

  function applyFilters(next: Record<string, string>) {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value) merged.set(key, value);
      else merged.delete(key);
    }
    // Any filter change resets to page 1, so results cannot be silently empty.
    merged.delete('page');
    setParams(merged);
  }

  function handleSearchSubmit(event: FormEvent) {
    event.preventDefault();
    applyFilters({ search: searchDraft.trim(), country: countryDraft.trim() });
  }

  function goToPage(nextPage: number) {
    const merged = new URLSearchParams(params);
    merged.set('page', String(nextPage));
    setParams(merged);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const hasFilters = Boolean(search || country || category);

  return (
    <Container className="py-10">
      <header>
        <h1 className="text-2xl font-semibold sm:text-3xl">Discover businesses</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Search published business profiles by name, description, category and country. Only
          published profiles appear here.
        </p>
      </header>

      <form onSubmit={handleSearchSubmit} className="mt-6 grid gap-3 sm:grid-cols-[2fr_1fr_auto]">
        <div>
          <label htmlFor="dir-search" className="sr-only">
            Search businesses
          </label>
          <input
            id="dir-search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="Search by name, description or category"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="dir-country" className="sr-only">
            Country code
          </label>
          <input
            id="dir-country"
            value={countryDraft}
            onChange={(event) => setCountryDraft(event.target.value.toUpperCase())}
            placeholder="Country code, e.g. IN"
            maxLength={2}
            className={inputClass}
          />
        </div>
        <Button type="submit">Search</Button>
      </form>

      {categories.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Category</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => applyFilters({ category: '' })}
              className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${
                category === ''
                  ? 'bg-navy-900 text-white ring-navy-900'
                  : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'
              }`}
            >
              All
            </button>
            {categories.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => applyFilters({ category: item })}
                className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${
                  category === item
                    ? 'bg-navy-900 text-white ring-navy-900'
                    : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-8">
        {loading && <Spinner label="Loading directory" />}

        {!loading && error && (
          <Alert tone="error" title="Directory unavailable">
            {error}
          </Alert>
        )}

        {!loading && !error && result && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-600">
                {result.total === 0
                  ? 'No businesses matched.'
                  : `${result.total} ${result.total === 1 ? 'business' : 'businesses'} found.`}
              </p>
              {hasFilters && (
                <Button tone="ghost" onClick={() => setParams(new URLSearchParams())}>
                  Clear filters
                </Button>
              )}
            </div>

            {result.items.length === 0 ? (
              <div className="mt-5">
                <EmptyState title={hasFilters ? 'No businesses matched your filters' : 'The directory is empty'}>
                  {hasFilters
                    ? 'Try a broader search, or clear the filters to see everything published.'
                    : 'No businesses have published a profile yet. We do not display sample or placeholder businesses.'}
                </EmptyState>
              </div>
            ) : (
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {result.items.map((business) => {
                  const held = business.verification.filter((entry) => entry.held);
                  return (
                    <Card key={business.ubpId} className="flex flex-col p-5">
                      <div className="flex items-start justify-between gap-2">
                        <h2 className="text-sm font-semibold text-navy-900">{business.displayName}</h2>
                        <span className="shrink-0 font-mono text-[0.65rem] text-slate-400">
                          {business.ubpId}
                        </span>
                      </div>

                      {business.tagline && (
                        <p className="mt-1.5 line-clamp-2 text-sm text-slate-600">{business.tagline}</p>
                      )}

                      <dl className="mt-3 space-y-1 text-xs text-slate-500">
                        {business.category && (
                          <div className="flex gap-1.5">
                            <dt className="font-medium text-slate-600">Category:</dt>
                            <dd>{business.category}</dd>
                          </div>
                        )}
                        {locationLabel(business) && (
                          <div className="flex gap-1.5">
                            <dt className="font-medium text-slate-600">Location:</dt>
                            <dd>{locationLabel(business)}</dd>
                          </div>
                        )}
                        {business.languages.length > 0 && (
                          <div className="flex gap-1.5">
                            <dt className="font-medium text-slate-600">Languages:</dt>
                            <dd>{business.languages.join(', ')}</dd>
                          </div>
                        )}
                        <div className="flex gap-1.5">
                          <dt className="font-medium text-slate-600">Verification:</dt>
                          <dd>
                            {held.length} of {business.verification.length} levels held
                          </dd>
                        </div>
                      </dl>

                      <div className="mt-auto pt-4">
                        <Link
                          to={`/business/${business.slug}`}
                          className="text-sm font-medium text-navy-700 hover:text-navy-900"
                        >
                          View profile →
                        </Link>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}

            {result.totalPages > 1 && (
              <nav aria-label="Pagination" className="mt-8 flex items-center justify-center gap-3">
                <Button
                  tone="secondary"
                  disabled={result.page <= 1}
                  onClick={() => goToPage(result.page - 1)}
                >
                  Previous
                </Button>
                <span className="text-sm text-slate-600">
                  Page {result.page} of {result.totalPages}
                </span>
                <Button
                  tone="secondary"
                  disabled={result.page >= result.totalPages}
                  onClick={() => goToPage(result.page + 1)}
                >
                  Next
                </Button>
              </nav>
            )}
          </>
        )}
      </div>
    </Container>
  );
}

