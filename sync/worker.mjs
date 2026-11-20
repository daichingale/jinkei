const TOKEN = /^[a-f0-9]{64}$/;
const LIMIT = 512 * 1024;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Jinkei-Create',
  'Access-Control-Max-Age': '86400',
  'Cache-Control': 'no-store',
};
const json = (body, status = 200) => Response.json(body, { status, headers: CORS });

async function readProject(request) {
  if (!request.body || Number(request.headers.get('Content-Length')) > LIMIT) return null;
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > LIMIT) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  try {
    const project = JSON.parse(await new Blob(chunks).text());
    if (typeof project?.name !== 'string' || !project.name.trim() || project.name.length > 240) return null;
    if (typeof project.source !== 'string' || !Number.isSafeInteger(project.revision) || project.revision < 0) return null;
    return project;
  } catch {
    return null;
  }
}

export class Project {
  constructor(ctx) {
    this.storage = ctx.storage;
  }

  async fetch(request) {
    if (request.method === 'GET') {
      const current = await this.storage.get('project');
      if (!current) return json({ error: 'project_not_found' }, 404);
      if (new URL(request.url).searchParams.get('after') === String(current.revision)) {
        return new Response(null, { status: 204, headers: CORS });
      }
      return json(current);
    }

    const input = await readProject(request);
    if (!input) return json({ error: 'invalid_project' }, 400);
    return this.storage.transaction(async txn => {
      const current = await txn.get('project');
      if (request.method === 'POST' && (current || input.revision !== 0)) {
        return json({ error: 'project_exists' }, 409);
      }
      if (request.method === 'PUT' && !current) return json({ error: 'project_not_found' }, 404);
      if (current && current.revision !== input.revision) return json(current, 409);
      const next = { name: input.name, source: input.source, revision: input.revision + 1 };
      await txn.put('project', next);
      return json(next);
    });
  }
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname.replace(/\/$/, '') !== '/project') return json({ error: 'not_found' }, 404);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (!['GET', 'POST', 'PUT'].includes(request.method)) return json({ error: 'method_not_allowed' }, 405);
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
    if (!TOKEN.test(token)) return json({ error: 'invalid_key' }, 401);
    if (request.method === 'POST' && (!env.SYNC_CREATE_KEY ||
        request.headers.get('X-Jinkei-Create') !== env.SYNC_CREATE_KEY)) {
      return json({ error: 'invalid_creation_key' }, 403);
    }
    return env.PROJECTS.get(env.PROJECTS.idFromName(token)).fetch(request);
  },
};
