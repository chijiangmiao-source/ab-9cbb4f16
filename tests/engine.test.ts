/**
 * 投影规则测试：
 *  1. 内置演练一（同发送方不同标签）必须通过；
 *  2. 内置演练二（旁观方等待不同发送方）必须拒绝并展示两条不可合并路径；
 *  3. 每个选择拥有唯一发送方；
 *  4. 同一选择中指向同一接收方的标签不得重复；
 *  5. 递归状态受消息守卫；
 *  6. 递归局部类型按协归比较：名称不同但行为相同的环不得误报冲突；
 *  7. 录入上限（6 参与方 / 12 状态 / 48 条）与基本引用校验。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkGuardedness, validateProtocol, LIMITS, type Protocol } from '../shared/model.js';
import { coindEqual, merge, verifyProtocol, type LNode } from '../shared/engine.js';
import { DRILLS } from '../shared/drills.js';

const drillMerge = DRILLS.find((d) => d.id === 'drill-merge')!;
const drillConflict = DRILLS.find((d) => d.id === 'drill-conflict')!;

// ---------------------------------------------------------------- 内置演练

test('演练一：A 选择后两支均由 B 向 C 发送不同标签，应通过', () => {
  const r = verifyProtocol(drillMerge.protocol);
  assert.equal(r.ok, true, JSON.stringify(r.errors ?? r.validationErrors));
  assert.equal(r.machines!.length, 3);

  const [mA, mB, mC] = r.machines!;
  // A：内部选择，向 B 发送 x / y
  assert.equal(mA.type, '⊕{ B!x. end, B!y. end }');
  // B：外部选择接收 x / y，之后分别向 C 发送 l1 / l2
  assert.equal(mB.type, '&{ A?x. ⊕{ C!l1. end }, A?y. ⊕{ C!l2. end } }');
  // C：旁观方，两支合并为同一发送方 B 驱动、标签不重叠的外部选择
  assert.equal(mC.type, '&{ B?l1. end, B?l2. end }');
  const cRecv = mC.transitions.filter((t) => t.dir === 'recv');
  assert.deepEqual(
    cRecv.map((t) => `${t.peer}?${t.label}`).sort(),
    ['B?l1', 'B?l2'],
  );
});

test('演练二：C 在两支分别等待 B 与 D，必须拒绝并展示两条不可合并路径', () => {
  const r = verifyProtocol(drillConflict.protocol);
  assert.equal(r.ok, false);
  assert.ok(r.errors && r.errors.length > 0);

  const first = r.errors[0];
  assert.equal(first.participant, 'C');
  assert.equal(first.choiceState, 'S0');
  assert.match(first.reason, /发送方不一致/);

  // 两条不可合并的路径：S0→S1（等待 B 的 l1）与 S0→S2（等待 D 的 l2）
  assert.equal(first.sides.length, 2);
  const [side1, side2] = first.sides;
  assert.match(side1.summary, /从 B 接收「l1」/);
  assert.match(side2.summary, /从 D 接收「l2」/);
  assert.deepEqual(
    side1.path.map((s) => `${s.from}-[${s.via}]->${s.to}`),
    ['S0-[A→B: x]->S1', 'S1-[B→C: l1]->S3'],
  );
  assert.deepEqual(
    side2.path.map((s) => `${s.from}-[${s.via}]->${s.to}`),
    ['S0-[A→B: y]->S2', 'S2-[D→C: l2]->S3'],
  );
});

// ---------------------------------------------------------------- 唯一发送方

test('每个选择必须拥有唯一发送方', () => {
  const p: Protocol = {
    participants: ['A', 'B', 'C', 'D'],
    states: ['S0', 'S1', 'S2'],
    initial: 'S0',
    transitions: [
      { from: 'S0', sender: 'A', receiver: 'B', label: 'x', to: 'S1' },
      { from: 'S0', sender: 'C', receiver: 'D', label: 'y', to: 'S2' },
    ],
  };
  const errs = validateProtocol(p);
  assert.ok(errs.some((e) => e.includes('唯一发送方')), errs.join(' | '));
});

test('同一选择中指向同一接收方的标签不得重复', () => {
  const p: Protocol = {
    participants: ['A', 'B'],
    states: ['S0', 'S1', 'S2'],
    initial: 'S0',
    transitions: [
      { from: 'S0', sender: 'A', receiver: 'B', label: 'x', to: 'S1' },
      { from: 'S0', sender: 'A', receiver: 'B', label: 'x', to: 'S2' },
    ],
  };
  const errs = validateProtocol(p);
  assert.ok(errs.some((e) => e.includes('重复')), errs.join(' | '));
});

// ---------------------------------------------------------------- 消息守卫

test('递归状态必须受消息守卫：无消息的环被拒绝', () => {
  const errs = checkGuardedness(
    ['S0', 'S1'],
    [
      { from: 'S0', to: 'S1', isMessage: false },
      { from: 'S1', to: 'S0', isMessage: false },
    ],
  );
  assert.equal(errs.length, 1);
  assert.match(errs[0], /未受消息守卫/);
});

test('递归状态受消息守卫：环上至少一条消息即通过', () => {
  const errs = checkGuardedness(
    ['S0', 'S1'],
    [
      { from: 'S0', to: 'S1', isMessage: true },
      { from: 'S1', to: 'S0', isMessage: false },
    ],
  );
  assert.equal(errs.length, 0);
});

test('带消息自环的递归规程通过校验与投影', () => {
  const p: Protocol = {
    participants: ['A', 'B'],
    states: ['S0', 'S1'],
    initial: 'S0',
    transitions: [
      { from: 'S0', sender: 'A', receiver: 'B', label: 'again', to: 'S0' },
      { from: 'S0', sender: 'A', receiver: 'B', label: 'stop', to: 'S1' },
    ],
  };
  assert.deepEqual(validateProtocol(p), []);
  const r = verifyProtocol(p);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const mB = r.machines!.find((m) => m.participant === 'B')!;
  assert.equal(mB.type, 'μX1. &{ A?again. X1, A?stop. end }');
  // 递归体现为本地状态机中的回边
  assert.ok(mB.transitions.some((t) => t.from === t.to));
});

// ---------------------------------------------------------------- 协归比较

test('协归比较：名称不同但行为相同的环不得误报冲突', () => {
  // 两支分别是经 S1、S2 命名的环，但行为相同（无限接收 B 的 l）
  const p: Protocol = {
    participants: ['A', 'B', 'C'],
    states: ['S0', 'S1', 'S2'],
    initial: 'S0',
    transitions: [
      { from: 'S0', sender: 'A', receiver: 'B', label: 'x', to: 'S1' },
      { from: 'S0', sender: 'A', receiver: 'B', label: 'y', to: 'S2' },
      { from: 'S1', sender: 'B', receiver: 'C', label: 'l', to: 'S1' },
      { from: 'S2', sender: 'B', receiver: 'C', label: 'l', to: 'S2' },
    ],
  };
  const r = verifyProtocol(p);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const mC = r.machines!.find((m) => m.participant === 'C')!;
  assert.equal(mC.type, 'μX1. &{ B?l. X1 }');
});

test('协归相等：手工构造的两个同构环相等，且可直接合并', () => {
  const a: LNode = { kind: 'external', filled: true };
  a.recvs = [{ from: 'B', label: 'l', cont: a }];
  const b: LNode = { kind: 'external', filled: true };
  b.recvs = [{ from: 'B', label: 'l', cont: b }];
  assert.equal(coindEqual(a, b), true);
  assert.equal(merge(a, b), a);

  const c: LNode = { kind: 'external', filled: true };
  c.recvs = [{ from: 'B', label: 'other', cont: c }];
  assert.equal(coindEqual(a, c), false);
});

test('环中未参与交互的参与方投影为 end（μt.t 等价于 end）', () => {
  const p: Protocol = {
    participants: ['A', 'B', 'C'],
    states: ['S0'],
    initial: 'S0',
    transitions: [{ from: 'S0', sender: 'B', receiver: 'C', label: 'l', to: 'S0' }],
  };
  const r = verifyProtocol(p);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const mA = r.machines!.find((m) => m.participant === 'A')!;
  assert.equal(mA.type, 'end');
  assert.equal(mA.transitions.length, 0);
});

// ---------------------------------------------------------------- 合并规则

test('旁观方在同一选择中接收同一发送方的多个标签可合并', () => {
  const p: Protocol = {
    participants: ['A', 'B'],
    states: ['S0', 'S1', 'S2'],
    initial: 'S0',
    transitions: [
      { from: 'S0', sender: 'A', receiver: 'B', label: 'l1', to: 'S1' },
      { from: 'S0', sender: 'A', receiver: 'B', label: 'l2', to: 'S2' },
    ],
  };
  const r = verifyProtocol(p);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const mB = r.machines!.find((m) => m.participant === 'B')!;
  assert.equal(mB.type, '&{ A?l1. end, A?l2. end }');
});

test('旁观方一支已结束、另一支仍需发送时必须拒绝', () => {
  const p: Protocol = {
    participants: ['A', 'B', 'C'],
    states: ['S0', 'S1', 'S2', 'S3'],
    initial: 'S0',
    transitions: [
      { from: 'S0', sender: 'A', receiver: 'B', label: 'x', to: 'S1' },
      { from: 'S0', sender: 'A', receiver: 'B', label: 'y', to: 'S2' },
      { from: 'S2', sender: 'C', receiver: 'B', label: 'l', to: 'S3' },
    ],
  };
  const r = verifyProtocol(p);
  assert.equal(r.ok, false);
  const err = r.errors!.find((e) => e.participant === 'C')!;
  assert.equal(err.choiceState, 'S0');
  assert.match(err.reason, /类别不一致/);
});

// ---------------------------------------------------------------- 录入上限与引用

test('录入上限：参与方 6、状态 12、消息/选择分支 48', () => {
  const many: Protocol = {
    participants: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'],
    states: ['S0'],
    initial: 'S0',
    transitions: [],
  };
  assert.ok(validateProtocol(many).some((e) => e.includes(`上限 ${LIMITS.participants}`)));

  const states = Array.from({ length: 13 }, (_, i) => `S${i}`);
  assert.ok(
    validateProtocol({ participants: ['A'], states, initial: 'S0', transitions: [] }).some((e) =>
      e.includes(`上限 ${LIMITS.states}`),
    ),
  );

  const transitions = Array.from({ length: 49 }, (_, i) => ({
    from: 'S0',
    sender: 'A',
    receiver: 'B',
    label: `m${i}`,
    to: 'S0',
  }));
  assert.ok(
    validateProtocol({ participants: ['A', 'B'], states: ['S0'], initial: 'S0', transitions }).some((e) =>
      e.includes(`上限 ${LIMITS.transitions}`),
    ),
  );
});

test('引用校验：未知状态、未知参与方、自发自收、空标签', () => {
  const p: Protocol = {
    participants: ['A', 'B'],
    states: ['S0'],
    initial: 'S0',
    transitions: [
      { from: 'S0', sender: 'A', receiver: 'B', label: 'ok', to: 'Sx' },
      { from: 'S0', sender: 'A', receiver: 'A', label: 'self', to: 'S0' },
      { from: 'S0', sender: 'A', receiver: 'C', label: 'ghost', to: 'S0' },
      { from: 'S0', sender: 'A', receiver: 'B', label: ' ', to: 'S0' },
    ],
  };
  const errs = validateProtocol(p);
  assert.ok(errs.some((e) => e.includes('目标状态')), errs.join(' | '));
  assert.ok(errs.some((e) => e.includes('不能相同')), errs.join(' | '));
  assert.ok(errs.some((e) => e.includes('不是已声明的参与方')), errs.join(' | '));
  assert.ok(errs.some((e) => e.includes('标签不能为空')), errs.join(' | '));
});
