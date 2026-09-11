/**
 * The browser's side of the REST API. Every call carries the session cookie;
 * state-changing calls are JSON with the same-origin headers the server's
 * CSRF check expects. Errors become a readable German message.
 */
export class ApiError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const message = data?.error || (res.status === 401 ? 'Nicht angemeldet' : `Fehler ${res.status}`);
    const details = data?.details;
    throw new ApiError(res.status, details && details.length ? `${message}: ${details.join('; ')}` : message, details);
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body = {}) => request('POST', url, body),
  put: (url, body = {}) => request('PUT', url, body),
  patch: (url, body = {}) => request('PATCH', url, body),
  delete: (url) => request('DELETE', url),
};
