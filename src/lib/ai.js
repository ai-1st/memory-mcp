import { generateObject } from 'ai';
import { bedrock } from '@ai-sdk/amazon-bedrock';
import { z } from 'zod';

const MODEL = bedrock('us.anthropic.claude-sonnet-4-5-20250929-v1:0');

/**
 * Extract topics from document contents.
 * Returns array of {category, summary}.
 */
export async function extractTopics(contents, url) {
  const { object } = await generateObject({
    model: MODEL,
    schema: z.object({
      topics: z.array(z.object({
        category: z.string().describe('A hierarchical category path using "/" to separate levels, e.g. "devops/kubernetes/autoscaling", "programming/python/web-frameworks", "cloud/aws/lambda". Use lowercase kebab-case for each segment. Use 2-3 levels of depth.'),
        summary: z.string().describe('A detailed factual paragraph about the topic, 500-1000 characters long. Should be comprehensive, self-contained, and stand on its own without the source document. Include specific details, names, numbers, and relationships.'),
      })),
    }),
    prompt: `Extract the key topics and facts from this document. Each topic summary must be a substantial paragraph of 500-1000 characters that captures detailed knowledge. Be specific and include concrete details.

Source URL: ${url}

Document contents:
${contents}`,
  });

  return object.topics;
}

/**
 * Given a new topic and similar existing topics, decide whether to ADD as new
 * or REPLACE existing topics with a merged one.
 */
export async function classifyTopicAction(newSummary, newCategory, similarTopics) {
  if (similarTopics.length === 0) {
    return { action: 'ADD', category: newCategory, summary: newSummary, replaceIds: [] };
  }

  const similarContext = similarTopics
    .map((t, i) => `[${i}] id=${t.id} category="${t.category}" summary="${t.summary}" (similarity: ${t.score.toFixed(3)})`)
    .join('\n');

  const { object } = await generateObject({
    model: MODEL,
    schema: z.object({
      action: z.enum(['ADD', 'REPLACE']).describe('ADD = create a brand new topic. REPLACE = merge with existing topics, replacing them.'),
      category: z.string().describe('The hierarchical category path using "/" to separate levels (e.g. "devops/kubernetes/autoscaling"). Use lowercase kebab-case, 2-3 levels.'),
      summary: z.string().describe('A detailed factual paragraph about the topic, 500-1000 characters long. If REPLACE, merge relevant information from all topics being replaced into one comprehensive paragraph.'),
      replaceIds: z.array(z.string()).describe('If REPLACE, the IDs of existing topics to replace. Empty array if ADD.'),
    }),
    prompt: `You are deciding how to organize a knowledge base of topics.

A new topic has been extracted from a document:
  category: "${newCategory}"
  summary: "${newSummary}"

Here are the most similar existing topics in the knowledge base:
${similarContext}

Rules:
- If the new topic covers substantially the same fact(s) as one or more existing topics (similarity > 0.85), choose REPLACE and merge the information into a single improved summary.
- If the new topic is distinct, choose ADD.
- When replacing, include ALL topic IDs that are being superseded.
- The merged summary should be comprehensive, combining information from all sources.`,
  });

  return object;
}
