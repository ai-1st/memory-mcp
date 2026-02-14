import { listProjects as queryProjects } from '../lib/db.js';

export const listProjects = {
  name: 'list_projects',
  description: 'List all projects',
  inputSchema: {
    type: 'object',
    properties: {},
  },

  async execute() {
    const projects = await queryProjects();

    const result = projects.map(p => ({
      id: p.id,
      name: p.name,
      createdAt: p.createdAt,
    }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ projects: result }, null, 2),
      }],
      isError: false,
    };
  },
};
