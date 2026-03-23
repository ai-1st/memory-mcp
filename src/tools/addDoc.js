import { processDocument } from '../lib/processor.js';

export const addDoc = {
  name: 'add_doc',
  description: 'Add a document and automatically generate chunks from it for retrieval',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'Source URL of the document',
      },
      contents: {
        type: 'string',
        description: 'Full text contents of the document',
      },
      title: {
        type: 'string',
        description: 'Title of the document / page',
      },
      force: {
        type: 'boolean',
        description: 'Force reprocessing even if content has not changed',
      },
    },
    required: ['url', 'contents'],
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
    const { url, contents, title = '', force = false } = args;
    const { projectId } = config;

    const result = await processDocument(projectId, { url, contents, title, force });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
      isError: false,
    };
  },
};
