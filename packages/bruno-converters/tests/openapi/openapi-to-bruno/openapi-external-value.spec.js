import { describe, it, expect } from '@jest/globals';
import openApiToBruno from '../../../src/openapi/openapi-to-bruno';

const flattenRequests = (collection) =>
  (collection.items || []).flatMap((item) => (item.items ? item.items : [item])).filter((item) => item.type === 'http-request');

describe('openApiToBruno - unresolved externalValue examples', () => {
  it('does not leak the raw example object into response example bodies', () => {
    const spec = {
      openapi: '3.0.3',
      info: { title: 't', version: '1' },
      servers: [{ url: 'https://api.example.com' }],
      paths: {
        '/me': {
          get: {
            responses: {
              200: {
                description: 'ok',
                content: {
                  'application/json': {
                    examples: {
                      me: { summary: 'Me', externalValue: './examples/me.json' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    };

    const collection = openApiToBruno(spec, { groupBy: 'tags' });
    const request = flattenRequests(collection)[0];
    const example = request.examples[0];

    expect(example.name).toBe('Me');
    expect(example.response.body.content || '').not.toContain('externalValue');
  });

  it('does not leak the raw example object into request body of examples', () => {
    const spec = {
      openapi: '3.0.3',
      info: { title: 't', version: '1' },
      servers: [{ url: 'https://api.example.com' }],
      paths: {
        '/users': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  examples: {
                    newUser: { summary: 'New user', externalValue: './examples/new-user.json' }
                  }
                }
              }
            },
            responses: {
              201: { description: 'created' }
            }
          }
        }
      }
    };

    const collection = openApiToBruno(spec, { groupBy: 'tags' });
    const request = flattenRequests(collection)[0];

    const serialized = JSON.stringify(request.examples);
    expect(serialized).not.toContain('externalValue');
  });

  it('still uses example objects whose value was resolved', () => {
    const spec = {
      openapi: '3.0.3',
      info: { title: 't', version: '1' },
      servers: [{ url: 'https://api.example.com' }],
      paths: {
        '/me': {
          get: {
            responses: {
              200: {
                description: 'ok',
                content: {
                  'application/json': {
                    examples: {
                      me: { summary: 'Me', value: { id: 1 } }
                    }
                  }
                }
              }
            }
          }
        }
      }
    };

    const collection = openApiToBruno(spec, { groupBy: 'tags' });
    const request = flattenRequests(collection)[0];
    expect(request.examples[0].response.body.content).toContain('"id"');
  });
});
