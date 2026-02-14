import crypto from 'crypto';
import { ulid } from 'ulid';
import { putDoc, putTopic, getTopic, replaceTopic, incrementCategory } from '../lib/db.js';
import { generateEmbedding, putVector, deleteVector, findSimilarByEmbedding } from '../lib/embeddings.js';
import { extractHowTos, classifyHowToAction } from '../lib/ai.js';

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * Store a how-to entry (or merge with existing), returning the result record.
 */
async function processEntry(projectId, docId, { category, title, body }, results) {
  const textToEmbed = `${title}\n\n${body}`;
  const hash = sha256(textToEmbed);

  // Generate embedding (with DDB cache)
  const embedding = await generateEmbedding(textToEmbed, hash);

  // Find similar existing entries
  const similar = await findSimilarByEmbedding(projectId, embedding, 5);

  // Classify: ADD or REPLACE
  const action = await classifyHowToAction(body, category, title, similar);

  const topicId = ulid();

  if (action.action === 'REPLACE' && action.replaceIds.length > 0) {
    // Collect all doc_ids from entries being replaced
    const allDocIds = new Set([docId]);
    const categoryDeltas = {};

    for (const oldId of action.replaceIds) {
      const oldTopic = await getTopic(projectId, oldId);
      if (oldTopic) {
        for (const did of (oldTopic.doc_ids || [])) {
          allDocIds.add(did);
        }
        await replaceTopic(projectId, oldId, topicId);
        await deleteVector(projectId, oldId);

        const oldCat = oldTopic.category;
        categoryDeltas[oldCat] = (categoryDeltas[oldCat] || 0) - 1;
      }
    }

    // Create new merged entry
    const mergedText = `${action.title}\n\n${action.summary}`;
    const newHash = sha256(mergedText);
    const newEmbedding = await generateEmbedding(mergedText, newHash);

    const topic = {
      id: topicId,
      category: action.category,
      title: action.title,
      summary: action.summary,
      doc_ids: [...allDocIds],
      sha256: newHash,
    };

    await putTopic(projectId, topic);
    await putVector(projectId, topicId, {
      id: topicId,
      category: action.category,
      title: action.title,
      summary: action.summary,
      doc_ids: [...allDocIds],
      embedding: newEmbedding,
    });

    categoryDeltas[action.category] = (categoryDeltas[action.category] || 0) + 1;

    for (const [cat, delta] of Object.entries(categoryDeltas)) {
      if (delta !== 0) {
        await incrementCategory(projectId, cat, delta);
      }
    }

    results.push({
      action: 'REPLACE',
      topicId,
      category: action.category,
      title: action.title,
      summary: action.summary,
      replaced: action.replaceIds,
    });
  } else {
    // ADD new entry
    const topic = {
      id: topicId,
      category: action.category,
      title: action.title,
      summary: body,
      doc_ids: [docId],
      sha256: hash,
    };

    await putTopic(projectId, topic);
    await putVector(projectId, topicId, {
      id: topicId,
      category: action.category,
      title: action.title,
      summary: body,
      doc_ids: [docId],
      embedding,
    });
    await incrementCategory(projectId, action.category, 1);

    results.push({
      action: 'ADD',
      topicId,
      category: action.category,
      title: action.title,
      summary: body,
    });
  }
}

export const addDoc = {
  name: 'add_doc',
  description: 'Add a document and automatically extract how-to procedures from it',
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
    const { url, contents } = args;
    const { projectId } = config;
    const docId = ulid();

    // 1. Store the document
    await putDoc(projectId, { id: docId, url, contents });

    // 2. Extract how-tos via LLM
    const { summary, howtos } = await extractHowTos(contents, url);

    const results = [];

    // 3. Process the high-level summary how-to first
    await processEntry(projectId, docId, {
      category: summary.category,
      title: summary.title,
      body: summary.body,
    }, results);

    // 4. Process each specific how-to
    for (const howto of howtos) {
      const body = howto.notes
        ? `${howto.steps}\n\nNotes: ${howto.notes}`
        : howto.steps;

      await processEntry(projectId, docId, {
        category: howto.category,
        title: howto.title,
        body,
      }, results);
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          docId,
          url,
          howTosProcessed: results.length,
          howtos: results,
        }, null, 2),
      }],
      isError: false,
    };
  },
};
