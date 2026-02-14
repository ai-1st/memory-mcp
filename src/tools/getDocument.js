import { getDoc } from '../lib/db.js';

export const getDocument = {
  name: 'get_document',
  description: 'Retrieve a document by its ID',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The ULID of the document to retrieve',
      },
    },
    required: ['id'],
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

  async execute(args, config) {
    const { id } = args;
    const { projectId } = config;
    const doc = await getDoc(projectId, id);

    if (!doc) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: `Document not found: ${id}` }),
        }],
        isError: true,
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          id: doc.id,
          url: doc.url,
          contents: doc.contents,
          createdAt: doc.createdAt,
        }, null, 2),
      }],
      isError: false,
    };
  },
};
