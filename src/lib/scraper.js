import { htmlToText } from './html.js';

// ── Jira ──

function buildTicketDocument(issue) {
  const fields = issue.fields;
  const renderedFields = issue.renderedFields || {};
  const key = issue.key;

  const parts = [`# ${key}: ${fields.summary}`];

  const meta = [
    `Project: ${fields.project?.name || fields.project?.key || ''}`,
    `Type: ${fields.issuetype?.name || ''}`,
    `Status: ${fields.status?.name || ''}`,
    `Resolution: ${fields.resolution?.name || ''}`,
  ];
  if (fields.labels?.length) meta.push(`Labels: ${fields.labels.join(', ')}`);
  if (fields.components?.length) meta.push(`Components: ${fields.components.map(c => c.name).join(', ')}`);
  parts.push(meta.join('\n'));

  const descHtml = renderedFields.description || '';
  const descText = descHtml ? htmlToText(descHtml) : (fields.description || '');
  if (descText) parts.push(`## Description\n\n${descText}`);

  const comments = renderedFields.comment?.comments || fields.comment?.comments || [];
  if (comments.length) {
    const commentTexts = comments.map(c => {
      const author = c.author?.displayName || 'Unknown';
      const body = c.renderedBody ? htmlToText(c.renderedBody) : (c.body || '');
      return `**${author}:**\n${body}`;
    });
    parts.push(`## Comments\n\n${commentTexts.join('\n\n---\n\n')}`);
  }

  return parts.join('\n\n');
}

/**
 * Scrape Jira tickets matching a JQL query.
 * Yields { url, title, contents } for each ticket.
 */
export async function* scrapeJira({ baseUrl, email, token, jql }) {
  const authHeader = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');
  const PAGE_SIZE = 50;
  let nextPageToken = null;
  let isLast = false;

  async function jiraGet(path) {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Jira API ${res.status}: ${body.slice(0, 300)}`);
    }
    return res.json();
  }

  while (!isLast) {
    let searchPath = `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${PAGE_SIZE}`
      + `&fields=summary,description,status,resolution,issuetype,project,labels,components,comment,created,resolutiondate`
      + `&expand=renderedFields`;
    if (nextPageToken) searchPath += `&nextPageToken=${encodeURIComponent(nextPageToken)}`;

    const data = await jiraGet(searchPath);

    for (const issue of data.issues) {
      const key = issue.key;
      const summary = issue.fields.summary;
      const ticketUrl = `${baseUrl}/browse/${key}`;
      const doc = buildTicketDocument(issue);

      if (doc.length < 100) continue;

      yield { url: ticketUrl, title: `${key}: ${summary}`, contents: doc };
    }

    nextPageToken = data.nextPageToken || null;
    isLast = data.isLast !== false;
    if (data.issues.length === 0) break;
  }
}

// ── Confluence ──

/**
 * Scrape Confluence pages under a parent page or folder (recursive).
 * Yields { url, title, contents } for each page.
 */
export async function* scrapeConfluence({ baseUrl, email, token, parentUrl }) {
  const authHeader = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');

  let parentId;
  let parentIsFolder = false;

  const folderMatch = parentUrl.match(/\/(?:wiki\/)?spaces\/[^/]+\/folder\/(\d+)/)
    || parentUrl.match(/\/folder\/(\d+)/);
  if (folderMatch) {
    parentId = folderMatch[1];
    parentIsFolder = true;
  } else {
    const pageMatch = parentUrl.match(/^(?:https:\/\/[^/]+)?\/wiki\/.*\/pages\/(\d+)/)
      || parentUrl.match(/\/pages\/(\d+)/);
    if (pageMatch) parentId = pageMatch[1];
    else throw new Error('Could not parse Confluence URL — expected a /pages/ or /folder/ URL');
  }

  async function confluenceGet(path) {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Confluence API ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json();
  }

  async function getChildren(parentId, childType, expand = '') {
    const children = [];
    let start = 0;
    const limit = 50;
    const expandParam = expand ? `&expand=${expand}` : '';
    while (true) {
      const data = await confluenceGet(
        `/wiki/rest/api/content/${parentId}/child/${childType}?start=${start}&limit=${limit}${expandParam}`
      );
      children.push(...data.results);
      if (data.size < limit) break;
      start += limit;
    }
    return children;
  }

  function makePage(page) {
    const bodyHtml = page.body?.storage?.value || '';
    const text = htmlToText(bodyHtml);
    if (text.length < 50) return null;
    const webui = page._links?.webui;
    const url = webui ? `${baseUrl}/wiki${webui}` : `${baseUrl}/wiki/pages/viewpage.action?pageId=${page.id}`;
    return {
      url,
      title: page.title,
      contents: `# ${page.title}\n\n${text}`,
    };
  }

  if (!parentIsFolder) {
    const parentPage = await confluenceGet(
      `/wiki/rest/api/content/${parentId}?expand=body.storage`
    );
    const parentDoc = makePage(parentPage);
    if (parentDoc) yield parentDoc;
  }

  async function* walkPages(nodeId) {
    const [childPages, childFolders] = await Promise.all([
      getChildren(nodeId, 'page', 'body.storage'),
      getChildren(nodeId, 'folder'),
    ]);

    for (const folder of childFolders) {
      yield* walkPages(folder.id);
    }

    for (const page of childPages) {
      const doc = makePage(page);
      if (doc) yield doc;
      yield* walkPages(page.id);
    }
  }

  yield* walkPages(parentId);
}
