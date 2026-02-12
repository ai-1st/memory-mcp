import crypto from 'crypto';
import { ulid } from 'ulid';
import { putDoc, putTopic, getTopic, replaceTopic, incrementCategory } from '../lib/db.js';
import { generateEmbedding, putVector, deleteVector, findSimilarByEmbedding } from '../lib/embeddings.js';
import { extractTopics, classifyTopicAction } from '../lib/ai.js';

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export const addDoc = {
  name: 'add_doc',
  description: 'Add a document and automatically extract topics/facts from it',
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

  async execute(args) {
    const { url, contents } = args;
    const docId = ulid();

    // 1. Store the document
    await putDoc({ id: docId, url, contents });

    // 2. Extract topics via LLM
    const rawTopics = await extractTopics(contents, url);

    const results = [];

    // 3. Process each extracted topic
    for (const raw of rawTopics) {
      const hash = sha256(raw.summary);

      // 3a. Generate embedding (with DDB cache)
      const embedding = await generateEmbedding(raw.summary, hash);

      // 3b. Find similar existing topics
      const similar = await findSimilarByEmbedding(embedding, 5);

      // 3c. Classify: ADD or REPLACE
      const action = await classifyTopicAction(raw.summary, raw.category, similar);

      const topicId = ulid();

      if (action.action === 'REPLACE' && action.replaceIds.length > 0) {
        // Collect all doc_ids from topics being replaced
        const allDocIds = new Set([docId]);
        const categoryDeltas = {}; // track category count changes

        for (const oldId of action.replaceIds) {
          const oldTopic = await getTopic(oldId);
          if (oldTopic) {
            for (const did of (oldTopic.doc_ids || [])) {
              allDocIds.add(did);
            }
            // Move old topic to REPLACED
            await replaceTopic(oldId, topicId);
            await deleteVector(oldId);

            // Decrement old category
            const oldCat = oldTopic.category;
            categoryDeltas[oldCat] = (categoryDeltas[oldCat] || 0) - 1;
          }
        }

        // Create new merged topic
        const newHash = sha256(action.summary);
        const newEmbedding = await generateEmbedding(action.summary, newHash);

        const topic = {
          id: topicId,
          category: action.category,
          summary: action.summary,
          doc_ids: [...allDocIds],
          sha256: newHash,
        };

        await putTopic(topic);
        await putVector(topicId, {
          id: topicId,
          category: action.category,
          summary: action.summary,
          embedding: newEmbedding,
        });

        // Increment new category
        categoryDeltas[action.category] = (categoryDeltas[action.category] || 0) + 1;

        // Apply all category deltas
        for (const [cat, delta] of Object.entries(categoryDeltas)) {
          if (delta !== 0) {
            await incrementCategory(cat, delta);
          }
        }

        results.push({
          action: 'REPLACE',
          topicId,
          category: action.category,
          summary: action.summary,
          replaced: action.replaceIds,
        });
      } else {
        // ADD new topic
        const topic = {
          id: topicId,
          category: action.category,
          summary: action.summary,
          doc_ids: [docId],
          sha256: hash,
        };

        await putTopic(topic);
        await putVector(topicId, {
          id: topicId,
          category: action.category,
          summary: action.summary,
          embedding,
        });
        await incrementCategory(action.category, 1);

        results.push({
          action: 'ADD',
          topicId,
          category: action.category,
          summary: action.summary,
        });
      }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          docId,
          url,
          topicsProcessed: results.length,
          topics: results,
        }, null, 2),
      }],
      isError: false,
    };
  },
};
