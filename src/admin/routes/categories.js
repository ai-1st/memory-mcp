import { listCategories as dbListCategories, queryTopicsByCategory } from '../../lib/db.js';

export async function list({ params }) {
  const [projectId] = params;
  const categories = await dbListCategories(projectId);
  return {
    statusCode: 200,
    body: { categories: categories.map(c => ({ category: c.category, topicCount: c.topicCount })) },
  };
}

export async function listTopics({ params, query }) {
  const [projectId] = params;
  const category = query.category;
  if (!category) return { statusCode: 400, body: { error: 'category query parameter is required' } };

  const topics = await queryTopicsByCategory(projectId, category);
  return {
    statusCode: 200,
    body: {
      topics: topics.map(t => ({
        id: t.id,
        category: t.category,
        title: t.title,
        summary: t.summary,
        doc_ids: t.doc_ids || [],
      })),
    },
  };
}
