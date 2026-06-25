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

  const visitParameters = (parameters, basePath) => {
    if (!Array.isArray(parameters)) return;
    parameters.forEach((p, i) => {
      if (p && p.examples) pushExamples(p.examples, `${basePath}[${i}].examples`);
    });
  };

  const paths = spec?.paths || {};
  for (const p of Object.keys(paths)) {
    const pathItem = paths[p] || {};
    visitParameters(pathItem.parameters, `paths.${p}.parameters`);
    for (const method of Object.keys(pathItem)) {
      if (method === 'parameters') continue;
      const op = pathItem[method];
      if (!op || typeof op !== 'object') continue;
      visitParameters(op.parameters, `paths.${p}.${method}.parameters`);
      if (op.requestBody?.content) {
        visitContent(op.requestBody.content, `paths.${p}.${method}.requestBody.content`);
      }
      const responses = op.responses || {};
      for (const status of Object.keys(responses)) {
        const r = responses[status];
        if (r?.content) visitContent(r.content, `paths.${p}.${method}.responses.${status}.content`);
      }
    }
  }

  const componentExamples = spec?.components?.examples;
  if (componentExamples) pushExamples(componentExamples, 'components.examples');

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
