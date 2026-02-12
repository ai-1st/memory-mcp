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

  async execute(args) {
    const { id } = args;
    const doc = await getDoc(id);

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
