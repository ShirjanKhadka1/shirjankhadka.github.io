/**
 * Nepse Decode: Shared data-fetch module
 * 
 * Standardized data loading for all auto-updating views.
 * Patterns learned from Capital Max + Chukul research (2026-10-07):
 * - One dateType vocabulary across all views
 * - Response envelope with asof date from payload
 * - Retry with exponential backoff (better than Capital Max's alert('Error'))
 * - Cache-busting so updates are visible after cron runs
 * - Freshness always from payload, never client clock
 * 
 * Usage:
 *   const data = await ND.fetchData('/nepse-brokers/data/periods/1W.json');
 *   console.log(data.asof); // "2026-10-06" — from payload
 */

(function(global) {
  'use strict';

  // Standard dateType vocabulary (matches Capital Max enum + our periods)
  const DATE_TYPES = {
    'latest': 'Latest trading session',
    '1D': 'Last trading day',
    '2D': 'Last 2 trading days',
    '1W': 'Last 7 trading days',
    '2W': 'Last 14 trading days',
    '1M': 'Last 30 trading days',
    '3M': 'Last 91 trading days',
    '6M': 'Last 182 trading days',
    '1Y': 'Last 365 trading days',
    '2Y': 'Last 730 trading days',
    '3Y': 'Last 1095 trading days'
  };

  // Fetch with retry and exponential backoff
  async function fetchWithRetry(url, options = {}) {
    const maxRetries = options.maxRetries || 3;
    const baseDelay = options.baseDelay || 1000;
    
    // Cache-busting: append timestamp so CDN serves fresh data after cron runs
    const separator = url.includes('?') ? '&' : '?';
    const bustedUrl = `${url}${separator}_=${Date.now()}`;
    
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(bustedUrl, {
          ...options,
          headers: {
            'Accept': 'application/json',
            ...options.headers
          }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        return data;
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s
          const delay = baseDelay * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  }

  // Standardized data fetch with envelope normalization
  async function fetchData(url, options = {}) {
    const raw = await fetchWithRetry(url, options);
    
    // Normalize to envelope format (handles both our format and legacy)
    // Our format: {asof, period, brokers, symbols, ...}
    // Returns as-is with guaranteed asof field
    if (!raw.asof && raw.to) {
      raw.asof = raw.to; // fallback to 'to' date
    }
    if (!raw.asof && raw.latest) {
      raw.asof = raw.latest;
    }
    
    return raw;
  }

  // Get human-readable label for a dateType
  function dateTypeLabel(dateType) {
    return DATE_TYPES[dateType] || dateType;
  }

  // Check if a dateType is valid
  function isValidDateType(dateType) {
    return dateType in DATE_TYPES;
  }

  // Format asof date for display (always from payload)
  function formatAsof(asof) {
    if (!asof) return 'Date unavailable';
    try {
      const d = new Date(asof + 'T00:00:00+05:45');
      return d.toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'Asia/Kathmandu'
      }).toUpperCase();
    } catch {
      return asof;
    }
  }

  // Global period state manager (avoids Capital Max's per-widget date bug)
  const PeriodState = {
    _current: 'latest',
    _listeners: [],
    
    get() {
      return this._current;
    },
    
    set(dateType) {
      if (!isValidDateType(dateType)) {
        console.warn(`Invalid dateType: ${dateType}`);
        return;
      }
      if (this._current !== dateType) {
        this._current = dateType;
        this._listeners.forEach(fn => {
          try { fn(dateType); } catch (e) { console.error(e); }
        });
        // Persist to URL without history spam
        try {
          const url = new URL(window.location);
          url.searchParams.set('period', dateType);
          window.history.replaceState({}, '', url);
        } catch {}
      }
    },
    
    subscribe(fn) {
      this._listeners.push(fn);
      return () => {
        this._listeners = this._listeners.filter(f => f !== fn);
      };
    },
    
    // Initialize from URL on page load
    initFromURL() {
      try {
        const params = new URLSearchParams(window.location.search);
        const p = params.get('period');
        if (p && isValidDateType(p)) {
          this._current = p;
        }
      } catch {}
      return this._current;
    }
  };

  // Export
  global.ND = global.ND || {};
  global.ND.fetchData = fetchData;
  global.ND.fetchWithRetry = fetchWithRetry;
  global.ND.dateTypeLabel = dateTypeLabel;
  global.ND.isValidDateType = isValidDateType;
  global.ND.formatAsof = formatAsof;
  global.ND.PeriodState = PeriodState;
  global.ND.DATE_TYPES = DATE_TYPES;

})(typeof window !== 'undefined' ? window : this);
