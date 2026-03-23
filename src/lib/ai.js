import { generateText, Output } from 'ai';
import { bedrock } from '@ai-sdk/amazon-bedrock';
import { z } from 'zod';

function debug(msg, extra = {}) {
  console.log(JSON.stringify({ ts: Date.now(), debug: msg, ...extra }));
}

const MODEL = bedrock('us.anthropic.claude-haiku-4-5-20251001-v1:0');

const DEFAULT_CHUNKING_PROMPT = `You are processing a document for a retrieval-augmented generation (RAG) system. Your job is to break the document into chunks that will be embedded and used for semantic search.

Produce three types of chunks:

1. SUMMARY (exactly one): A concise summary of the entire document — its purpose, what it covers, and when someone would need it. Prepend it with a short context line: "This document is about [topic]. [source context]."

2. QA (one per distinct piece of information): Question/answer pairs covering each key fact, procedure, or concept in the document. The question should be phrased the way a user would naturally ask it. The answer should be self-contained and include all necessary details (commands, URLs, config values, etc.). Prepend each Q&A with a context line: "From a document about [topic]: "

3. TEXT (one per meaningful section): Actual text passages from the source document. Each TEXT chunk MUST be 500-1500 characters — this is a hard requirement; short chunks are useless for retrieval. Copy the original wording verbatim — do NOT summarize, condense, or paraphrase. Include full code blocks, command examples, configuration snippets, and tables exactly as they appear. Prepend each passage with a brief context line (50-150 chars) that situates it, e.g. "This section from [document about X] describes [specific aspect]: "

Rules:
- Every chunk must be self-contained — someone reading just that chunk should understand it without seeing the rest of the document
- Include specific details: commands, file paths, URLs, config values, error messages, version numbers
- Do NOT produce generic chunks that could apply to any document
- Q&A questions should be phrased naturally, as a user would search for them`;

const chunkSchema = z.object({
  chunks: z.array(z.object({
    type: z.enum(['summary', 'qa', 'text']),
    content: z.string().describe('The chunk text with contextual preamble prepended.'),
  })),
});

/**
 * Generate chunks from document contents.
 * Uses the project's custom chunking prompt if set, otherwise the default.
 */
export async function generateChunks(contents, url, customPrompt = '') {
  const systemPrompt = customPrompt || DEFAULT_CHUNKING_PROMPT;

  const t0 = Date.now();
  const { output, usage } = await generateText({
    model: MODEL,
    output: Output.object({ schema: chunkSchema }),
    system: systemPrompt,
    prompt: `Source URL: ${url}

Document contents:
${contents}`,
  });

  debug('generateChunks', {
    durationMs: Date.now() - t0,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    chunksCount: output?.chunks?.length ?? 0,
  });

  return output;
}

export { DEFAULT_CHUNKING_PROMPT };
