import { ulid } from 'ulid';
import { listProjects, putProject } from '../../lib/db.js';

export async function list() {
  const projects = await listProjects();
  return {
    statusCode: 200,
    body: { projects: projects.map(p => ({ id: p.id, name: p.name, rules: p.rules, createdAt: p.createdAt })) },
  };
}

export async function create({ body }) {
  const { name, rules } = body;
  if (!name) return { statusCode: 400, body: { error: 'name is required' } };

  const id = ulid();
  const project = { id, name };
  if (rules) project.rules = rules;
  await putProject(project);

  return { statusCode: 201, body: { id, name, rules: rules || '', createdAt: new Date().toISOString() } };
}
