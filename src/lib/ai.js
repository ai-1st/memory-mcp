import { generateText, Output } from 'ai';
import { bedrock } from '@ai-sdk/amazon-bedrock';
import { z } from 'zod';

// const MODEL = bedrock('us.anthropic.claude-sonnet-4-5-20250929-v1:0');
// const MODEL = bedrock('us.anthropic.claude-haiku-4-5-20251001-v1:0');
const MODEL = bedrock('us.anthropic.claude-sonnet-4-6');

/**
 * Extract how-tos from document contents.
 * Returns { summary, howtos: [{ category, title, steps, notes }] }.
 *
 * - summary: a high-level how-to that captures the overall purpose of the document
 * - howtos: specific, actionable procedures found in the document
 */
export async function extractHowTos(contents, url, categorizationRules = '') {
  const rulesBlock = categorizationRules
    ? `\n\nCATEGORIZATION RULES (you MUST follow these when assigning categories):\n${categorizationRules}\n`
    : '';

  const { output } = await generateText({
    model: MODEL,
    output: Output.object({
      schema: z.object({
        summary: z.object({
          category: z.string().describe('A hierarchical category path using "/" to separate levels. Use lowercase kebab-case for each segment, 2-3 levels. Must follow the categorization rules if provided.'),
          title: z.string().describe('A concise title for the overall how-to, e.g. "How to manage Khoros deployments" or "How to troubleshoot authentication failures". Start with "How to".'),
          body: z.string().describe('A high-level summary (500-1000 chars) of what this document teaches you to do. Describe the overall purpose, when you would use these procedures, and what systems/tools are involved. This should help someone decide if this document is relevant to their problem.'),
        }),
        howtos: z.array(z.object({
          category: z.string().describe('A hierarchical category path using "/" to separate levels. Use lowercase kebab-case, 2-3 levels. Must follow the categorization rules if provided.'),
          title: z.string().describe('A concise action-oriented title starting with "How to", e.g. "How to restart the Khoros application server", "How to rotate database credentials".'),
          steps: z.string().describe('The step-by-step procedure (500-2000 chars). Use numbered steps. Include specific commands, paths, URLs, config values, and expected outputs. Should be actionable by someone following along.'),
          notes: z.string().describe('Important warnings, prerequisites, gotchas, or context (0-500 chars). Empty string if none.'),
        })),
      }),
    }),
    prompt: `Extract actionable how-to procedures from this document. A single document may describe how to do many different things — extract each as a separate how-to.

For each how-to:
- Title should start with "How to"
- Steps should be numbered and specific enough to follow
- Include exact commands, file paths, URLs, config keys, and expected outputs
- Include prerequisites or warnings in notes
- Each how-to should cover exactly ONE procedure. Do not combine multiple distinct actions (e.g. deploy AND rollback) into a single how-to.

Do NOT extract:
- Generic procedures someone could find in public documentation (e.g. "How to SSH into a server", "How to run a SQL query", "How to create a Git branch"). Only extract procedures containing organization-specific details: internal hostnames, product-specific commands, proprietary config values, or internal tooling.
- If the document describes the same procedure repeated for multiple services/components using a template pattern, extract ONE generalized how-to describing the pattern (with placeholders for the service name), not separate how-tos per service.

Also produce a high-level summary how-to that captures the overall purpose of the document — this helps match generic searches like "how do I deal with X" to the right document.
${rulesBlock}
Source URL: ${url}

Document contents:
${contents}`,
  });

  return output;
}

/**
 * LLM-as-judge: evaluate extracted how-tos against their source document.
 * Returns scores (1-5) and specific findings for completeness, specificity, and search fitness.
 */
export async function judgeDocument(sourceContents, topics) {
  const topicList = topics
    .map((t, i) => `[${i}] title: "${t.title}"\n    category: "${t.category}"\n    body: "${t.summary}"`)
    .join('\n\n');

  const { output } = await generateText({
    model: MODEL,
    output: Output.object({
      schema: z.object({
        completeness: z.object({
          score: z.number().describe('1-5 score. 5 = all actionable procedures captured, 1 = most missed.'),
          missing: z.array(z.string()).describe('Actionable procedures present in the source but NOT covered by any extracted how-to. Empty if none.'),
        }),
        specificity: z.object({
          score: z.number().describe('1-5 score. 5 = all topics contain org-specific knowledge, 1 = mostly generic.'),
          generic: z.array(z.object({
            index: z.number().describe('Index of the generic topic in the list above.'),
            reason: z.string().describe('Why this topic is generic (e.g. "standard Linux commands with no org-specific context").'),
          })).describe('Topics that contain only generic knowledge available in public docs. Empty if none.'),
        }),
        searchFitness: z.object({
          score: z.number().describe('1-5 score. 5 = each topic is well-scoped for search, 1 = topics are too broad or vague.'),
          issues: z.array(z.object({
            index: z.number().describe('Index of the problematic topic.'),
            reason: z.string().describe('Why this topic is poorly scoped (e.g. "mixes deployment and rollback into one topic" or "title too vague to match a specific query").'),
          })).describe('Topics with search-fitness problems. Empty if none.'),
        }),
      }),
    }),
    prompt: `You are evaluating the quality of how-to extraction from a source document. Below is the original document and the how-tos that were extracted from it.

Evaluate three dimensions:

1. COMPLETENESS: Are all actionable procedures from the source document captured in the how-tos? List any specific procedures that were missed. Do NOT count general context or background information as missing — only concrete, step-by-step procedures.

2. SPECIFICITY: Flag any how-to that contains only generic knowledge (standard Linux commands, general SQL syntax, common tool usage) without organization-specific context (hostnames, internal paths, config values, product-specific details). These are low-value entries that someone could find in public documentation.

3. SEARCH FITNESS: Each how-to will be stored as a separate chunk for vector similarity search. Evaluate whether each topic is well-scoped:
   - Too broad: mixes multiple distinct procedures that someone might search for independently
   - Too vague: title or body doesn't contain specific enough terms to match a targeted query
   - Good: covers exactly one procedure with specific, searchable terms in the title and body

SOURCE DOCUMENT:
${sourceContents}

EXTRACTED HOW-TOS:
${topicList}`,
  });

  return output;
}

/**
 * Given a new how-to and similar existing ones, decide whether to ADD as new
 * or REPLACE existing entries with a merged one.
 */
export async function classifyHowToAction(newBody, newCategory, newTitle, similarItems, categorizationRules = '') {
  if (similarItems.length === 0) {
    return { action: 'ADD', category: newCategory, title: newTitle, summary: newBody, replaceIds: [] };
  }

  const similarContext = similarItems
    .map((t, i) => `[${i}] id=${t.id} category="${t.category}" summary="${t.summary}" (similarity: ${t.score.toFixed(3)})`)
    .join('\n');

  const rulesBlock = categorizationRules
    ? `\nCategorization rules (follow these when assigning the category):\n${categorizationRules}\n`
    : '';

  const { output } = await generateText({
    model: MODEL,
    output: Output.object({
      schema: z.object({
        action: z.enum(['ADD', 'REPLACE']).describe('ADD = create a brand new entry. REPLACE = merge with existing entries, replacing them.'),
        category: z.string().describe('The hierarchical category path using "/" to separate levels. Use lowercase kebab-case, 2-3 levels.'),
        title: z.string().describe('A concise action-oriented title starting with "How to".'),
        summary: z.string().describe('The merged how-to content (500-2000 chars). If REPLACE, combine the steps and details from all entries being replaced into one comprehensive procedure.'),
        replaceIds: z.array(z.string()).describe('If REPLACE, the IDs of existing entries to replace. Empty array if ADD.'),
      }),
    }),
    prompt: `You are organizing a knowledge base of how-to procedures.

A new how-to has been extracted from a document:
  category: "${newCategory}"
  title: "${newTitle}"
  content: "${newBody}"

Here are the most similar existing entries in the knowledge base:
${similarContext}
${rulesBlock}
Rules:
- If the new how-to covers substantially the same procedure as one or more existing entries (similarity > 0.75), choose REPLACE and merge the information into a single improved how-to.
- If the new how-to is a distinct procedure, choose ADD.
- When replacing, include ALL entry IDs that are being superseded.
- The merged content should combine steps and details from all sources into one comprehensive procedure.
- IMPORTANT: When merging, the new how-to represents more recent information. If facts conflict (e.g. different port numbers, URLs, versions, config values), the new how-to's information takes precedence over older entries.`,
  });

  return output;
}
