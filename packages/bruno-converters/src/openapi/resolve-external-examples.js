import jsyaml from 'js-yaml';

const JSON_MEDIA = /^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i;
const YAML_MEDIA = /^(?:application|text)\/(?:x-)?yaml(?:\s*;|$)/i;

const looksYamlByPath = (uri) => /\.ya?ml(?:$|\?|#)/i.test(uri);

const parseContent = (raw, { mediaType, uri }) => {
  if (mediaType && JSON_MEDIA.test(mediaType)) {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  if ((mediaType && YAML_MEDIA.test(mediaType)) || (!mediaType && looksYamlByPath(uri))) {
    try { return jsyaml.load(raw); } catch { return raw; }
  }
  if (!mediaType) {
    try { return JSON.parse(raw); } catch { /* fall through */ }
  }
  return raw;
};

const isExampleObject = (obj) =>
  obj && typeof obj === 'object' && !Array.isArray(obj) && typeof obj.externalValue === 'string';

const collectExampleSites = (spec) => {
  const sites = [];
  const pushExamples = (examples, basePath) => {
    if (!examples || typeof examples !== 'object') return;
    for (const key of Object.keys(examples)) {
      sites.push({ container: examples, key, path: `${basePath}.${key}` });
    }
  };

  const visitContent = (content, basePath) => {
    if (!content || typeof content !== 'object') return;
    for (const mt of Object.keys(content)) {
      const entry = content[mt];
      if (entry && entry.examples) {
        pushExamples(entry.examples, `${basePath}.${mt}.examples`);
      }
    }
  };

  // Parameter and Header objects share the shape that carries examples
  const visitParameterLike = (p, basePath) => {
    if (!p || typeof p !== 'object') return;
    if (p.examples) pushExamples(p.examples, `${basePath}.examples`);
    if (p.content) visitContent(p.content, `${basePath}.content`);
  };

  const visitHeaders = (headers, basePath) => {
    if (!headers || typeof headers !== 'object') return;
    for (const name of Object.keys(headers)) {
      visitParameterLike(headers[name], `${basePath}.${name}`);
    }
  };

  const visitParameters = (parameters, basePath) => {
    if (!Array.isArray(parameters)) return;
    parameters.forEach((p, i) => visitParameterLike(p, `${basePath}[${i}]`));
  };

  const visitResponse = (response, basePath) => {
    if (!response || typeof response !== 'object') return;
    if (response.content) visitContent(response.content, `${basePath}.content`);
    if (response.headers) visitHeaders(response.headers, `${basePath}.headers`);
  };

  const visitRequestBody = (requestBody, basePath) => {
    if (requestBody?.content) visitContent(requestBody.content, `${basePath}.content`);
  };

  const visitPathItem = (pathItem, basePath) => {
    if (!pathItem || typeof pathItem !== 'object') return;
    visitParameters(pathItem.parameters, `${basePath}.parameters`);
    for (const method of Object.keys(pathItem)) {
      if (method === 'parameters') continue;
      const op = pathItem[method];
      if (!op || typeof op !== 'object') continue;
      visitParameters(op.parameters, `${basePath}.${method}.parameters`);
      visitRequestBody(op.requestBody, `${basePath}.${method}.requestBody`);
      const responses = op.responses || {};
      for (const status of Object.keys(responses)) {
        visitResponse(responses[status], `${basePath}.${method}.responses.${status}`);
      }
    }
  };

  const paths = spec?.paths || {};
  for (const p of Object.keys(paths)) {
    visitPathItem(paths[p], `paths.${p}`);
  }

  const components = spec?.components || {};
  if (components.examples) pushExamples(components.examples, 'components.examples');
  const eachEntry = (section, visit) => {
    const entries = components[section];
    if (!entries || typeof entries !== 'object') return;
    for (const name of Object.keys(entries)) {
      visit(entries[name], `components.${section}.${name}`);
    }
  };
  eachEntry('responses', visitResponse);
  eachEntry('requestBodies', visitRequestBody);
  eachEntry('parameters', visitParameterLike);
  eachEntry('headers', visitParameterLike);
  eachEntry('pathItems', visitPathItem);

  return sites;
};

const parentMediaTypeFor = (location) => {
  const m = /\.content\.([^.]+)\.examples\.[^.]+$/.exec(location);
  return m ? m[1] : undefined;
};

const resolveExternalExamples = async (spec, { readFile }) => {
  const issues = [];
  if (!spec || typeof spec !== 'object') return { spec, issues };

  const sites = collectExampleSites(spec);
  for (const site of sites) {
    const example = site.container[site.key];
    if (!isExampleObject(example)) continue;

    if (example.value !== undefined) {
      delete example.externalValue;
      continue;
    }

    const uri = example.externalValue;
    let payload;
    try {
      payload = await readFile(uri);
    } catch (err) {
      issues.push({
        severity: 'warning',
        path: site.path,
        message: `Could not resolve externalValue '${uri}': ${err.message}`
      });
      continue;
    }

    const mediaType = payload.mediaType || parentMediaTypeFor(site.path);
    const parsed = parseContent(String(payload.content ?? ''), { mediaType, uri });
    example.value = parsed;
    delete example.externalValue;
  }

  return { spec, issues };
};

export default resolveExternalExamples;
export { resolveExternalExamples };
