import { ulid } from 'ulid';
import { listProjects, getProject, putProject, updateProject as updateProjectData, deleteProject as deleteProjectData } from '../../lib/db.js';
import { deleteAllVectors } from '../../lib/embeddings.js';
import { DEFAULT_CHUNKING_PROMPT } from '../../lib/ai.js';

export async function list() {
  const projects = await listProjects();
  return {
    statusCode: 200,
    body: {
      projects: projects.map(p => ({
        id: p.id, name: p.name, prompts: p.prompts || {}, createdAt: p.createdAt,
      })),
    },
  };
}

export async function get({ params }) {
  const [projectId] = params;
  const project = await getProject(projectId);
  if (!project) return { statusCode: 404, body: { error: 'Project not found' } };
  return {
    statusCode: 200,
    body: {
      id: project.id, name: project.name,
      prompts: project.prompts || {},
      defaultPrompts: { chunking: DEFAULT_CHUNKING_PROMPT },
      createdAt: project.createdAt,
    },
  };
}

export async function create({ body }) {
  const { name, prompts } = body;
  if (!name) return { statusCode: 400, body: { error: 'name is required' } };

  const id = ulid();
  const project = { id, name };
  if (prompts) project.prompts = prompts;
  await putProject(project);

  return { statusCode: 201, body: { id, name, prompts: prompts || {}, createdAt: new Date().toISOString() } };
}

export async function update({ params, body }) {
  const [projectId] = params;
  const project = await getProject(projectId);
  if (!project) return { statusCode: 404, body: { error: 'Project not found' } };

  const updates = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.prompts !== undefined) updates.prompts = body.prompts;

  if (Object.keys(updates).length === 0) {
    return { statusCode: 400, body: { error: 'Nothing to update' } };
  }

  await updateProjectData(projectId, updates);

  return {
    statusCode: 200,
    body: {
      id: projectId,
      name: updates.name ?? project.name,
      prompts: updates.prompts ?? project.prompts ?? {},
    },
  };
}

export async function remove({ params }) {
  const [projectId] = params;
  const project = await getProject(projectId);
  if (!project) return { statusCode: 404, body: { error: 'Project not found' } };

  const [dbCounts, vectorsDeleted] = await Promise.all([
    deleteProjectData(projectId),
    deleteAllVectors(projectId),
  ]);

  return {
    statusCode: 200,
    body: { id: projectId, deleted: { db: dbCounts, vectors: vectorsDeleted } },
  };
}
