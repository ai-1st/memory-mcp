import crypto from 'crypto';
import { ulid } from 'ulid';
import { putDoc, updateDocStats, putTopic, getTopic, replaceTopic, incrementCategory, getProject, getLatestDocByUrl } from './db.js';
import { generateEmbedding, putVector, deleteVector, findSimilarByEmbedding } from './embeddings.js';
import { extractHowTos, classifyHowToAction } from './ai.js';

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function processEntry(projectId, docId, { category, title, body }, categorizationRules = '') {
  const textToEmbed = `${title}\n\n${body}`;
  const hash = sha256(textToEmbed);

  const embedding = await generateEmbedding(textToEmbed, hash);
  const similar = await findSimilarByEmbedding(projectId, embedding, 10);
  const action = await classifyHowToAction(body, category, title, similar, categorizationRules);

  const topicId = ulid();

  if (action.action === 'REPLACE' && action.replaceIds.length > 0) {
    const allDocIds = new Set([docId]);
    const categoryDeltas = {};

    for (const oldId of action.replaceIds) {
      const oldTopic = await getTopic(projectId, oldId);
      if (oldTopic) {
        for (const did of (oldTopic.doc_ids || [])) allDocIds.add(did);
        await replaceTopic(projectId, oldId, topicId);
        await deleteVector(projectId, oldId);
        const oldCat = oldTopic.category;
        categoryDeltas[oldCat] = (categoryDeltas[oldCat] || 0) - 1;
      }
    }

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
      id: topicId, category: action.category, title: action.title,
      summary: action.summary, doc_ids: [...allDocIds], embedding: newEmbedding,
    });

    categoryDeltas[action.category] = (categoryDeltas[action.category] || 0) + 1;
    for (const [cat, delta] of Object.entries(categoryDeltas)) {
      if (delta !== 0) await incrementCategory(projectId, cat, delta);
    }

    return {
      action: 'REPLACE', topicId, category: action.category,
      title: action.title, summary: action.summary, replaced: action.replaceIds,
    };
  } else {
    const topic = {
      id: topicId, category: action.category, title: action.title,
      summary: body, doc_ids: [docId], sha256: hash,
    };

    await putTopic(projectId, topic);
    await putVector(projectId, topicId, {
      id: topicId, category: action.category, title: action.title,
      summary: body, doc_ids: [docId], embedding,
    });
    await incrementCategory(projectId, action.category, 1);

    return {
      action: 'ADD', topicId, category: action.category,
      title: action.title, summary: body,
    };
  }
}

/**
 * Process a document end-to-end: dedup, store, extract, embed, classify.
 * Shared by Admin API POST /documents and ProcessWorker.
 */
export async function processDocument(projectId, { url, contents, title = '', force = false }) {
  const contentsSha256 = sha256(contents);

  if (!force) {
    const existing = await getLatestDocByUrl(projectId, url);
    if (existing && existing.contentsSha256 === contentsSha256) {
      return {
        docId: existing.id, url, skipped: true,
        reason: 'Content unchanged since last ingestion',
        topicsCreated: existing.topicsCreated ?? 0,
        topicsReplaced: existing.topicsReplaced ?? 0,
      };
    }
  }

  const docId = ulid();
  const project = await getProject(projectId);
  const rules = project?.rules || '';

  await putDoc(projectId, { id: docId, url, title, contents, contentsSha256 });

  const { summary, howtos } = await extractHowTos(contents, url, rules);

  const entries = [
    { category: summary.category, title: summary.title, body: summary.body },
    ...howtos.map(h => ({
      category: h.category,
      title: h.title,
      body: h.notes ? `${h.steps}\n\nNotes: ${h.notes}` : h.steps,
    })),
  ];

  const results = [];
  for (const entry of entries) {
    results.push(await processEntry(projectId, docId, entry, rules));
  }

  const topicsCreated = results.filter(r => r.action === 'ADD').length;
  const topicsReplaced = results.filter(r => r.action === 'REPLACE').length;

  await updateDocStats(projectId, docId, topicsCreated, topicsReplaced);

  return {
    docId, url, skipped: false,
    topicsCreated, topicsReplaced,
    howTosProcessed: results.length,
    howtos: results,
  };
}
