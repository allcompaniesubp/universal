/**
 * Local development / self-hosted server.
 *
 * Express is used only as a thin adapter: it reads the body and hands the
 * request to the shared router. All validation, authorisation and error
 * handling therefore live in the same code that runs on Vercel.
 *
 * Express is a devDependency: the deployed serverless function does not use it.
 */

import express from 'express';
import { buildRouter, dispatch } from './http/app.ts';
import { createRequest } from './http/router.ts';
import { loadConfig, resolveClientIp } from './config.ts';
import { serialiseCookie } from './http/cookies.ts';

const config = loadConfig();
const app = express();
const router = buildRouter();

app.disable('x-powered-by');
// `trust proxy` is deliberately off: Express would otherwise believe the
// client-supplied X-Forwarded-For header and hand back a spoofed address, which
// is exactly the bypass the rate limiter must not have. There is no trusted
// proxy in front of the local server, so the socket address is the right answer.
app.set('trust proxy', false);

app.use(express.json({ limit: '256kb' }));

app.all(/^\/api\/.*/, async (req, res) => {
  const apiRequest = createRequest({
    method: req.method,
    url: req.originalUrl,
    headers: req.headers,
    body: req.body,
    ip: resolveClientIp(config, req.headers, req.socket.remoteAddress ?? null),
  });

  const result = await dispatch(router, apiRequest, { isProduction: config.isProduction });

  res.status(result.status);
  for (const [key, value] of Object.entries(result.headers ?? {})) {
    res.setHeader(key, value);
  }
  if (result.cookies && result.cookies.length > 0) {
    res.setHeader(
      'Set-Cookie',
      result.cookies.map((cookie) => serialiseCookie(cookie.name, cookie.value, cookie.options)),
    );
  }

  if (result.body === undefined) {
    res.end();
    return;
  }
  const contentType = result.headers?.['Content-Type'] ?? '';
  if (typeof result.body === 'string' && !contentType.includes('application/json')) {
    res.send(result.body);
    return;
  }
  res.json(result.body);
});

const port = Number(process.env.API_PORT ?? '3001');
app.listen(port, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`[ubp] API server listening on http://0.0.0.0:${port}`);
});
