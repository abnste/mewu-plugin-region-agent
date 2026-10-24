import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the actual package entry. Only the documented SDK/host boundary is
// substituted; definePlugin is the SDK's identity wrapper, not a second agent.
const source = await fs.readFile(new URL('./index.mjs', import.meta.url), 'utf8');
const frame = (value, index = value) => ({ artifactId: `frame-${index}`, width: 780, height: 520, sha256: value.repeat(64) });
const click = { action: { kind: 'click', x: 90, y: 370 } };
const done = { done: true, message: '任务已完成' };
const pass = { complete: true, message: '实际计数为 4' };
async function harness(frames, decisions, overrides = {}) {
  const calls = [], actions = []; let tool, agent, observed = 0, modeled = 0;
  const context = vm.createContext({});
  const sdk = new vm.SyntheticModule(['definePlugin'], function () { this.setExport('definePlugin', fn => fn); }, { context });
  const module = new vm.SourceTextModule(source, { context, identifier: 'region-plugin/index.mjs' });
  await module.link(specifier => { assert.equal(specifier, '@mewu/sdk'); return sdk; });
  await module.evaluate();
  const ctx = {
    tools: { register: (_manifest, handler) => { tool = handler; } },
    agents: { register: (_manifest, handler) => { agent = handler; } },
    model: { invoke: async params => {
      calls.push({ method: 'model', params: structuredClone(params) });
      if (overrides.model) return overrides.model(params);
      assert.deepEqual(Array.from(params.messages), []);
      const value = decisions[modeled++]; assert.notEqual(value, undefined, 'unexpected model request');
      if (value instanceof Error) throw value;
      return { content: typeof value === 'string' ? value : JSON.stringify(value) };
    } },
    region: {
      observe: async id => {
        assert.equal(id, 'region'); calls.push({ method: 'observe' });
        const value = frames[observed++]; assert.notEqual(value, undefined, 'unexpected observation');
        if (value instanceof Error) throw value;
        return value;
      },
      action: async (id, action) => {
        assert.equal(id, 'region'); actions.push(structuredClone(action)); calls.push({ method: 'action' });
        if (overrides.action) return overrides.action(action);
        return { executed: true };
      }
    }
  };
  module.namespace.default(ctx);
  return { calls, actions, run: (input = { task: '只点击一次，让计数从 3 变为 4' }, scope = { regionId: 'region' }) => tool(input, { context: scope }), agent };
}

test('completion uses a new image and isolated context, and refuses a wrong actual result', async () => {
  const h = await harness([frame('a'), frame('b')], [done, { complete: false, message: '实际计数为 5，目标为 4' }]);
  const result = await h.run();
  assert.equal(result.completed, false); assert.equal(result.isError, true); assert.equal(result.stopReason, 'completion_unconfirmed');
  assert.equal(result.artifactId, 'frame-b'); assert.equal(h.actions.length, 0);
  const models = h.calls.filter(x => x.method === 'model');
  assert.deepEqual(models[0].params.images, ['frame-a']); assert.deepEqual(models[1].params.images, ['frame-b']);
  assert.match(models[1].params.prompt, /不代表事实/);
});

test('an identical click on unchanged feedback observes again instead of clicking twice', async () => {
  const h = await harness([frame('a', 1), frame('a', 2), frame('b', 3), frame('c', 4)], [click, click, done, pass]);
  const result = await h.run();
  assert.equal(result.completed, true); assert.equal(result.steps, 1); assert.equal(h.actions.length, 1);
  assert.deepEqual(h.calls.map(x => x.method), ['observe', 'model', 'action', 'observe', 'model', 'observe', 'model', 'observe', 'model']);
});

test('unchanged feedback has a finite observation budget and never replays input', async () => {
  const h = await harness([frame('a', 1), frame('a', 2), frame('a', 3), frame('a', 4)], [click, click, click]);
  const result = await h.run({ task: '点击按钮', maxSteps: 3 });
  assert.equal(result.completed, false); assert.equal(result.stopReason, 'step_limit'); assert.equal(h.actions.length, 1);
});

test('the same click after a visible state change can intentionally repeat', async () => {
  const h = await harness([frame('a'), frame('b'), frame('c'), frame('d')], [click, click, done, pass]);
  const result = await h.run({ task: '点击两次' });
  assert.equal(result.completed, true); assert.equal(result.steps, 2); assert.equal(h.actions.length, 2);
});

test('the same text is not inserted twice while feedback is unchanged', async () => {
  const input = { action: { kind: 'type', text: 'Stephen' } };
  const h = await harness([frame('a', 1), frame('a', 2), frame('b', 3), frame('c', 4)], [input, input, done, pass]);
  assert.equal((await h.run()).completed, true); assert.deepEqual(h.actions, [input.action]);
});

test('a different action is not blocked merely because the image is unchanged', async () => {
  const other = { action: { kind: 'click', x: 150, y: 180 } };
  const h = await harness([frame('a', 1), frame('a', 2), frame('b'), frame('c')], [click, other, done, pass]);
  assert.equal((await h.run()).completed, true); assert.deepEqual(h.actions, [click.action, other.action]);
});

test('invalid completion cannot be converted into success', async () => {
  const h = await harness([frame('a'), frame('b')], [done, { complete: 'yes', message: '完成' }]);
  const result = await h.run(); assert.equal(result.completed, false); assert.equal(result.stopReason, 'completion_unconfirmed');
});

test('completion verification cannot request another native action', async () => {
  const h = await harness([frame('a'), frame('b')], [done, click]);
  assert.equal((await h.run()).completed, false); assert.equal(h.actions.length, 0);
});

test('a failed native input keeps its unknown outcome and is not retried', async () => {
  const error = Object.assign(new Error('input outcome unknown'), { code: 'region_input_failed' });
  const h = await harness([frame('a')], [click], { action: () => { throw error; } });
  await assert.rejects(h.run(), e => e === error); assert.equal(h.actions.length, 1);
});

test('failed feedback preserves that the previous input was already sent', async () => {
  const error = Object.assign(new Error('capture unavailable'), { code: 'region_capture_failed' });
  const h = await harness([frame('a'), error], [click]);
  const result = await h.run(); assert.equal(result.completed, false); assert.equal(result.feedbackPending, true); assert.equal(result.steps, 1);
  assert.match(result.content, /不要重复该动作/); assert.equal(h.actions.length, 1);
});

test('invalid model actions are corrected without sending any input', async () => {
  const bad = { action: { kind: 'click', x: 780, y: 0 } };
  const h = await harness([frame('a')], [bad, bad, bad]);
  assert.equal((await h.run()).stopReason, 'invalid_model_decision'); assert.equal(h.actions.length, 0);
});

test('non-region agent conversations retain their explicit caller context', async () => {
  let received;
  const h = await harness([], [], { model: params => { received = structuredClone(params); return { content: '回复' }; } });
  const messages = [{ role: 'user', content: '上一条消息' }];
  const result = await h.agent({ task: '继续', messages, images: ['image'] }, { context: {} });
  assert.equal(result.content, '回复'); assert.deepEqual(received, { prompt: '继续', images: ['image'], messages });
});
