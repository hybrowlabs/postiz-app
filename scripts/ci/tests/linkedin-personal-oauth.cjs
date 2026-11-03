// Run from the repository root: node --test scripts/ci/tests/linkedin-personal-oauth.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const dayjs = require('dayjs');
// Provider objects come from a vm context; compare them as plain JSON.
const plain = (value) => JSON.parse(JSON.stringify(value));

// Load the real provider implementations, isolating unrelated publishing SDKs.
function providers(fetch, env = {}) {
  const loaded = {};
  class RefreshToken extends Error {}
  class SocialAbstract {
    fetch(url, options) {
      return fetch(url, options);
    }
    checkScopes(required, granted) {
      const scopes = String(granted).split(/[ ,]+/);
      if (!required.every((scope) => scopes.includes(scope))) {
        throw new Error('NotEnoughScopes');
      }
    }
  }
  function load(filename, exportName) {
    const source = fs.readFileSync(path.join(__dirname,
      '../../../libraries/nestjs-libraries/src/integrations/social', filename), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        experimentalDecorators: true, esModuleInterop: true },
    });
    const exports = {};
    vm.runInNewContext(outputText, {
      exports, fetch, URLSearchParams,
      process: { env: { LINKEDIN_CLIENT_ID: 'test-client', LINKEDIN_CLIENT_SECRET: 'test-secret',
        FRONTEND_URL: 'https://social.example.com', ...env } },
      require(id) {
        if (id === 'dayjs') return dayjs;
        if (id.endsWith('/social.abstract')) return { SocialAbstract, RefreshToken };
        if (id.endsWith('/linkedin.provider')) return { LinkedinProvider: loaded.personal };
        if (id.endsWith('/make.secure.id')) return { makeSecureId: () => 'test-random' };
        if (id.endsWith('/rules.description.decorator')) return { Rules: () => () => {} };
        if (id.endsWith('/post.plug')) return { PostPlug: () => () => {} };
        if (id.endsWith('/plug.decorator')) return { Plug: () => () => {} };
        return {};
      },
    });
    return exports[exportName];
  }
  loaded.personal = load('linkedin.provider.ts', 'LinkedinProvider');
  loaded.page = load('linkedin.page.provider.ts', 'LinkedinPageProvider');
  loaded.RefreshToken = RefreshToken;
  return loaded;
}

const ANALYTICS_ON = {
  LINKEDIN_MEMBER_POST_ANALYTICS: 'true',
  LINKEDIN_MEMBER_PROFILE_ANALYTICS: 'true',
};

// Answers memberCreatorPostAnalytics/memberFollowersCount like LinkedIn's
// documented samples; `fail` maps a queryType (or 'followers') to a status.
function memberApi(calls, fail = {}) {
  return async (url, options) => {
    calls.push({ url, options });
    const u = new URL(url);
    const key = u.pathname.endsWith('memberFollowersCount') ? 'followers' : u.searchParams.get('queryType');
    if (fail[key]) throw fail[key];
    const dateRange = { start: { year: 2026, month: 11, day: 1 }, end: { year: 2026, month: 11, day: 2 } };
    const element = key === 'followers'
      ? { memberFollowersCount: 4, dateRange }
      : { count: 10, metricType: key, ...(u.searchParams.get('aggregation') === 'DAILY' ? { dateRange } : {}) };
    return { json: async () => ({ elements: [element] }) };
  };
}

test('member analytics scopes stay off unless the flag is exactly "true"', async () => {
  for (const value of [undefined, 'false', '0', '1']) {
    const { personal } = providers(undefined, { LINKEDIN_MEMBER_POST_ANALYTICS: value, LINKEDIN_MEMBER_PROFILE_ANALYTICS: 'true' });
    const { url } = await new personal().generateAuthUrl();
    assert.equal(new URL(url).searchParams.get('scope'), 'openid profile w_member_social');
  }
  const { personal, page } = providers(undefined, ANALYTICS_ON);
  const personalScope = new URL((await new personal().generateAuthUrl()).url).searchParams.get('scope');
  assert.equal(personalScope, 'openid profile w_member_social r_member_postAnalytics r_member_profileAnalytics');
  const pageScope = new URL((await new page().generateAuthUrl()).url).searchParams.get('scope');
  assert.ok(!pageScope.includes('r_member_'));
});

test('personal analytics makes no LinkedIn calls while the flag is off', async () => {
  const calls = [];
  const { personal } = providers(memberApi(calls));
  assert.deepEqual(plain(await new personal().analytics('id', 'token', 7)), []);
  assert.deepEqual(plain(await new personal().postAnalytics('id', 'token', 'urn:li:share:1', 7)), []);
  assert.equal(calls.length, 0);
});

test('personal analytics returns every series with the flags on', async () => {
  const calls = [];
  const { personal } = providers(memberApi(calls), ANALYTICS_ON);
  const series = await new personal().analytics('id', 'token', 7);
  assert.deepEqual(plain(series.map((s) => s.label)),
    ['Impressions', 'Members Reached', 'Reactions', 'Comments', 'Reshares', 'Followers']);
  assert.equal(calls.length, 6);
  assert.ok(calls.every(({ url }) => url.startsWith('https://api.linkedin.com/rest/')));
  assert.equal(calls[0].options.headers.Authorization, 'Bearer token');
  assert.deepEqual(plain(series[0].data), [{ total: 10, date: '2026-11-01' }]);
});

test('one rejected metric drops only its own series', async () => {
  const calls = [];
  const { personal } = providers(memberApi(calls, { followers: new Error('403 scope') }), ANALYTICS_ON);
  const series = await new personal().analytics('id', 'token', 7);
  assert.deepEqual(plain(series.map((s) => s.label)),
    ['Impressions', 'Members Reached', 'Reactions', 'Comments', 'Reshares']);
});

test('an expired token still reaches the refresh path', async () => {
  const box = {};
  const loaded = providers((url, options) => box.fetch(url, options), ANALYTICS_ON);
  box.fetch = memberApi([], { IMPRESSION: new loaded.RefreshToken('expired') });
  await assert.rejects(new loaded.personal().analytics('id', 'token', 7),
    (e) => e instanceof loaded.RefreshToken);
});

test('per-post analytics maps share and ugcPost URNs to the entity finder', async () => {
  const calls = [];
  const { personal } = providers(memberApi(calls), ANALYTICS_ON);
  const series = await new personal().postAnalytics('id', 'token', 'urn:li:ugcPost:123', 7);
  assert.equal(series.length, 6);
  assert.ok(calls.every(({ url }) => url.includes('q=entity&entity=(ugc:urn%3Ali%3AugcPost%3A123)')));
  assert.deepEqual(plain(await new personal().postAnalytics('id', 'token', 'urn:li:activity:1', 7)), []);
});

test('personal OAuth requests self-service scopes and permits interactive consent', async () => {
  const { personal } = providers();
  const { url } = await new personal().generateAuthUrl();
  const params = new URL(url).searchParams;
  assert.equal(params.get('scope'), 'openid profile w_member_social');
  assert.equal(params.has('prompt'), false);
  assert.equal(params.get('redirect_uri'), 'https://social.example.com/integrations/social/linkedin');
  assert.equal(params.get('client_id'), 'test-client');
});

test('personal authentication succeeds with only OpenID and Share grants', async () => {
  const calls = [];
  const { personal } = providers(async (url) => {
    calls.push(url);
    if (url.endsWith('/accessToken')) return { json: async () => ({
      access_token: 'test-token', expires_in: 3600, scope: 'openid profile w_member_social',
    }) };
    assert.equal(url, 'https://api.linkedin.com/v2/userinfo');
    return { json: async () => ({ sub: 'member-id', name: 'Test Member', picture: 'avatar' }) };
  });
  const result = await new personal().authenticate({ code: 'test-code', codeVerifier: 'test-verifier' });
  assert.equal(result.id, 'member-id');
  assert.equal(result.name, 'Test Member');
  assert.equal(result.accessToken, 'test-token');
  assert.equal(calls.length, 2);
  assert.equal(result.username, '');
});

test('missing personal publishing grant is still rejected', async () => {
  const { personal } = providers(async () => ({ json: async () => ({
    access_token: 'test-token', scope: 'openid profile',
  }) }));
  await assert.rejects(new personal().authenticate({ code: 'test-code' }), /NotEnoughScopes/);
});

test('page OAuth retains organization permissions and its own callback', async () => {
  const { page } = providers();
  const { url } = await new page().generateAuthUrl();
  const params = new URL(url).searchParams;
  for (const scope of ['rw_organization_admin', 'w_organization_social', 'r_organization_social']) {
    assert.ok(params.get('scope').split(' ').includes(scope));
  }
  assert.equal(params.has('prompt'), false);
  assert.equal(params.get('redirect_uri'), 'https://social.example.com/integrations/social/linkedin-page');
});
