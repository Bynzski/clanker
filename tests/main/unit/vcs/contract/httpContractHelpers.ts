/**
 * HTTP Contract Test Helpers
 * Provides realistic HTTP mock server functionality for testing VCS providers.
 * Uses Node.js built-in http module to create a test server.
 */

import http from 'http';
import { AddressInfo } from 'net';

/**
 * Configuration for a single endpoint response.
 */
export interface MockEndpointConfig {
  path: string;
  method?: string;
  statusCode?: number;
  headers?: Record<string, string>;
  body?: string;
  delay?: number; // ms to delay response
  responseSize?: number; // if set, pads body to this size
}

/**
 * Response received by the client.
 */
export interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/**
 * Start a mock HTTP server for testing.
 * Returns server instance and base URL.
 */
export async function startMockServer(endpoints: MockEndpointConfig[]): Promise<{
  server: http.Server;
  baseUrl: string;
  capturedRequests: CapturedRequest[];
  close: () => Promise<void>;
}> {
  const capturedRequests: CapturedRequest[] = [];

  const server = http.createServer((req, res) => {
    // Capture request
    const url = req.url || '';
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') {
        headers[key] = value;
      } else if (Array.isArray(value)) {
        headers[key] = value.join(', ');
      }
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', () => {
      capturedRequests.push({ url, method: req.method || 'GET', headers, body });

      // Find matching endpoint
      const endpoint = endpoints.find(
        (e) => e.path === url && (e.method === undefined || e.method === req.method)
      );

      if (!endpoint) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }

      const delay = endpoint.delay || 0;
      const statusCode = endpoint.statusCode || 200;
      const responseHeaders = endpoint.headers || { 'Content-Type': 'application/json' };

      setTimeout(() => {
        res.writeHead(statusCode, responseHeaders);
        
        let responseBody = endpoint.body || '';
        if (endpoint.responseSize && responseBody.length < endpoint.responseSize) {
          // Pad response to specified size
          responseBody = responseBody.padEnd(endpoint.responseSize, ' ');
        }
        
        res.end(responseBody);
      }, delay);
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const address = server.address() as AddressInfo;
      const baseUrl = `http://localhost:${address.port}`;
      resolve({
        server,
        baseUrl,
        capturedRequests,
        close: () =>
          new Promise((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
    server.on('error', reject);
  });
}


