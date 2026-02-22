import { listDocs } from '../lib/db.js';

export const listDocuments = {
  name: 'list_documents',
  description: 'List all documents ingested into a project',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  configSchema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'The project ID to scope this operation to',
      },
    },
    required: ['projectId'],
  },

  async execute(_args, config) {
    const { projectId } = config;
    const docs = await listDocs(projectId);

    const result = docs.map(d => ({
      id: d.id,
      url: d.url,
      title: d.title || '',
      contentsSha256: d.contentsSha256 || '',
      topicsCreated: d.topicsCreated ?? 0,
      topicsReplaced: d.topicsReplaced ?? 0,
      createdAt: d.createdAt,
    }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ documents: result }, null, 2),
      }],
      isError: false,
    };
  },
};
