// Replace Node's built-in fetch (powered by bundled undici) with node-fetch.
//
// Node 22.20+ ships an undici whose HTTP/2 (and chunked-body) handling
// closes the response stream early when talking to googleapis.com/oauth2/v4/token,
// surfacing as "Invalid response body … Premature close" inside gaxios.
// node-fetch is HTTP/1.1-only over Node's `https` module and does not
// share the regression, so installing it as the global fetch lets
// google-auth-library / gaxios reach token exchange reliably again.

import nodeFetch, { Headers, Request, Response } from "node-fetch";

type FetchSignature = (input: unknown, init?: unknown) => Promise<unknown>;

const globalScope = globalThis as unknown as {
  fetch: FetchSignature;
  Headers: unknown;
  Request: unknown;
  Response: unknown;
};

globalScope.fetch = nodeFetch as unknown as FetchSignature;
globalScope.Headers = Headers;
globalScope.Request = Request;
globalScope.Response = Response;
