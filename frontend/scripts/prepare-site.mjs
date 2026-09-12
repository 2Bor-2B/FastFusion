import { mkdir, writeFile } from 'node:fs/promises';

const worker = `export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404 || request.method !== 'GET') return response;
    const fallback = new URL('/index.html', request.url);
    return env.ASSETS.fetch(new Request(fallback, request));
  },
};
`;

await mkdir(new URL('../dist/server/', import.meta.url), { recursive: true });
await writeFile(new URL('../dist/server/index.js', import.meta.url), worker);
