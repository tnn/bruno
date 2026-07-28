const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { resolveExternalExamples } = require('@usebruno/converters');

const isHttpUrl = (value) => typeof value === 'string' && /^https?:\/\//i.test(value);

const defaultHttpGet = async (url) => {
  const response = await axios.get(url, {
    timeout: 30000,
    maxContentLength: 10 * 1024 * 1024,
    transformResponse: [(data) => data]
  });
  return {
    content: typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
    mediaType: response.headers && response.headers['content-type']
  };
};

/**
 * Build a readFile function for resolveExternalExamples that resolves
 * externalValue uris against the collection's OpenAPI spec source:
 * relative uris resolve against the spec's directory (local file source)
 * or against the spec's URL (remote source).
 */
const makeSpecExampleReader = ({ sourceUrl, collectionPath, httpGet = defaultHttpGet }) => {
  const sourceIsUrl = isHttpUrl(sourceUrl);
  const baseUrl = sourceIsUrl ? sourceUrl : null;
  let baseDir = null;
  if (!sourceIsUrl && typeof sourceUrl === 'string' && sourceUrl.length) {
    const resolvedSpecPath = collectionPath ? path.resolve(collectionPath, sourceUrl) : path.resolve(sourceUrl);
    baseDir = path.dirname(resolvedSpecPath);
  }

  return async (uri) => {
    if (isHttpUrl(uri)) {
      return httpGet(uri);
    }
    if (baseUrl) {
      return httpGet(new URL(uri, baseUrl).toString());
    }
    if (!baseDir) {
      throw new Error('No spec source available to resolve relative externalValue uris');
    }
    const resolved = path.resolve(baseDir, uri);
    const content = await fs.promises.readFile(resolved, 'utf8');
    return { content };
  };
};

/**
 * Resolve externalValue example references on a deep clone of the spec,
 * leaving the input untouched (stored specs and spec hashes must stay raw).
 * Resolution failures are warnings: the clone keeps its externalValue and
 * the converter renders those examples with an empty value.
 */
const resolveSpecExternalExamples = async (spec, { sourceUrl, collectionPath } = {}) => {
  if (!spec || typeof spec !== 'object') return spec;

  const clone = structuredClone(spec);
  try {
    const readFile = makeSpecExampleReader({ sourceUrl, collectionPath });
    const { issues } = await resolveExternalExamples(clone, { readFile });
    for (const issue of issues || []) {
      console.warn(`[OpenAPI Sync] ${issue.path} — ${issue.message}`);
    }
  } catch (err) {
    console.warn('[OpenAPI Sync] Failed to resolve externalValue references:', err.message);
  }
  return clone;
};

module.exports = {
  makeSpecExampleReader,
  resolveSpecExternalExamples
};
