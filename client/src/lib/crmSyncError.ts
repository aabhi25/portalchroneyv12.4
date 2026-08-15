const TOKEN_RE = /^CRM_SYNC_ERROR\[(\w+)\]:\s*(.+)$/s;

const CATEGORY_LABELS: Record<string, string> = {
  json_error: '',
  html_response: 'Caprion server error',
  http_error: '',
  network_error: 'Connection error',
  unknown: 'Unknown error',
};

export function formatCrmSyncError(raw: string | null | undefined): string {
  if (!raw) return 'Sync failed — unknown reason';

  const match = raw.match(TOKEN_RE);
  if (match) {
    const [, category, body] = match;
    switch (category) {
      case 'json_error':
        return body.trim();
      case 'html_response':
        return body.trim();
      case 'http_error': {
        const status = body.match(/HTTP (\d+)/)?.[1];
        if (status === '401') return `Unauthorised (HTTP 401) — check your CRM API credentials in settings`;
        if (status === '403') return `Access denied (HTTP 403) — your IP may not be whitelisted or the API key lacks permission`;
        if (status === '404') return `CRM endpoint not found (HTTP 404) — check the CRM host URL in settings`;
        if (status === '422') return `CRM rejected the data (HTTP 422) — a required field may be missing or in wrong format`;
        if (status === '429') return `Too many requests (HTTP 429) — try again in a few minutes`;
        if (status === '500') return `Caprion server error (HTTP 500) — try again later or contact Caprion support`;
        if (status === '502' || status === '503' || status === '504') return `Caprion server is temporarily unavailable (${body.trim()}) — try again later`;
        return body.trim();
      }
      case 'network_error':
        return `Could not connect to CRM — ${body.trim()}`;
      default:
        return body.trim();
    }
  }

  const legacy = raw.toLowerCase();
  if (legacy.includes('401') || legacy.includes('unauthorized'))
    return 'Unauthorised — check your CRM API credentials in settings';
  if (legacy.includes('403') || legacy.includes('forbidden'))
    return 'Access denied — your IP may not be whitelisted or the API key lacks permission';
  if (legacy.includes('404'))
    return 'CRM endpoint not found — check the CRM host URL in settings';
  if (legacy.includes('429') || legacy.includes('rate limit'))
    return 'Too many requests — try syncing again in a few minutes';
  if (legacy.includes('500') || legacy.includes('internal server'))
    return 'CRM server had an internal error — try again later';
  if (legacy.includes('502') || legacy.includes('503') || legacy.includes('504') || legacy.includes('timeout'))
    return 'CRM server is temporarily unavailable — try again later';
  if (legacy.includes('econnrefused') || legacy.includes('enotfound') || legacy.includes('network'))
    return 'Could not connect to CRM — check your internet connection or CRM host URL';

  return raw;
}
