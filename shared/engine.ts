/**
 * 投影引擎：把全局规程投影为每个参与方的局部类型（规范本地状态机）。
 *
 * 规则：
 *  - 选择的发送方投影为内部选择 ⊕（主动发送）；
 *  - 选择的接收方投影为外部选择 &（被动接收）；
 *  - 非选择参与方（旁观方）投影为各分支投影的合并：
 *    仅当各分支可合成为「同一发送方驱动且标签不重叠的外部选择」时才能继续，
 *    否则该旁观方在分支后无法判断下一条消息，投影失败；
 *  - 递归局部类型以协归（互模拟）方式比较：名称不同但行为相同的环视为相同，不误报冲突。
 */
import { groupByFrom, validateProtocol, type Protocol, type Transition } from './model.js';

/** 局部类型节点（可为有环图，环即递归） */
export interface LNode {
  kind: 'end' | 'internal' | 'external';
  /** kind === 'internal' 时的发送分支 */
  sends?: SendBranch[];
  /** kind === 'external' 时的接收分支（同一发送方） */
  recvs?: RecvBranch[];
  /** 来源全局状态（用于诊断定位） */
  origin?: string[];
  /** 构造期间的占位标记（false 表示尚未填充，用于协归纳假设） */
  filled?: boolean;
}

export interface SendBranch {
  to: string;
  label: string;
  cont: LNode;
  origin?: string[];
}

export interface RecvBranch {
  from: string;
  label: string;
  cont: LNode;
  origin?: string[];
}

export interface PathSeg {
  from: string;
  /** 形如 "A→B: x" 的迁移描述 */
  via: string;
  to: string;
}

/** 不可合并分支中某一侧的画像 */
export interface ConflictSide {
  /** 该侧局部行为来源的全局状态 */
  states: string[];
  /** 该侧局部行为概述 */
  summary: string;
  /** 从选择状态到冲突点的代表路径（含触发冲突动作的那条迁移） */
  path: PathSeg[];
}

export interface ProjectionError {
  participant: string;
  /** 发生合并失败的选择状态 */
  choiceState: string;
  reason: string;
  /** 不可合并的两侧（各含一条分支路径） */
  sides: [ConflictSide, ConflictSide];
}

export interface LocalState {
  id: string;
  kind: 'end' | 'internal' | 'external';
}

export interface LocalTransition {
  from: string;
  dir: 'send' | 'recv';
  peer: string;
  label: string;
  to: string;
}

/** 某参与方的规范本地状态机 */
export interface LocalMachine {
  participant: string;
  initial: string;
  states: LocalState[];
  transitions: LocalTransition[];
  /** 局部类型的 μ 表达式（递归以 μX 表示） */
  type: string;
}

export interface VerifyResult {
  ok: boolean;
  /** 录入校验错误（数量上限、唯一发送方、消息守卫等） */
  validationErrors?: string[];
  /** 投影错误：首个不可投影点在最前 */
  errors?: ProjectionError[];
  /** 投影成功时各参与方的规范本地状态机 */
  machines?: LocalMachine[];
}

// ---------------------------------------------------------------------------
// 协归相等
// ---------------------------------------------------------------------------

const nodeIds = new WeakMap<LNode, number>();
let nextNodeId = 0;

function nid(n: LNode): number {
  let id = nodeIds.get(n);
  if (id === undefined) {
    id = ++nextNodeId;
    nodeIds.set(n, id);
  }
  return id;
}

function isUnfilled(n: LNode): boolean {
  return n.filled === false;
}

/**
 * 协归（互模拟）相等：沿两个局部类型同步展开，遇到已访问过的节点对即视为相等。
 * 因此名称不同但行为相同的环（如 μX. B?l.X 与 μY. B?l.Y）被判为相同，不会误报冲突。
 */
export function coindEqual(a: LNode, b: LNode): boolean {
  return eq(a, b, new Set<string>());
}

function eq(a: LNode, b: LNode, seen: Set<string>): boolean {
  if (a === b) return true;
  // 构造中的占位节点：作为协归纳假设接受
  if (isUnfilled(a) || isUnfilled(b)) return true;
  const key = `${nid(a)}#${nid(b)}`;
  if (seen.has(key)) return true;
  seen.add(key);
  if (a.kind !== b.kind) return false;
  if (a.kind === 'end') return true;
  if (a.kind === 'internal') {
    const as = a.sends ?? [];
    const bs = b.sends ?? [];
    if (as.length !== bs.length) return false;
    return as.every((s) => {
      const m = bs.find((t) => t.to === s.to && t.label === s.label);
      return m !== undefined && eq(s.cont, m.cont, seen);
    });
  }
  const as = a.recvs ?? [];
  const bs = b.recvs ?? [];
  if (as.length !== bs.length) return false;
  return as.every((r) => {
    const m = bs.find((t) => t.from === r.from && t.label === r.label);
    return m !== undefined && eq(r.cont, m.cont, seen);
  });
}

// ---------------------------------------------------------------------------
// 合并
// ---------------------------------------------------------------------------

interface MergeCtx {
  protocol: Protocol;
  participant: string;
  choiceState: string;
}

class MergeFailure extends Error {
  constructor(public readonly projError: ProjectionError) {
    super(projError.reason);
    this.name = 'MergeFailure';
  }
}

function unionOrigin(a?: string[], b?: string[]): string[] {
  return [...new Set([...(a ?? []), ...(b ?? [])])];
}

/**
 * 合并两个局部类型：
 *  - 协归相等 → 任取其一；
 *  - 均为同一发送方驱动、标签不重叠的外部选择 → 取两支的并集；
 *  - 其余 → 合并失败（抛出 MergeFailure，携带定位信息）。
 */
export function merge(a: LNode, b: LNode, ctx?: MergeCtx): LNode {
  if (isUnfilled(a)) return b;
  if (isUnfilled(b)) return a;
  if (coindEqual(a, b)) return a;
  if (a.kind === 'external' && b.kind === 'external') {
    const fa = a.recvs![0].from;
    const fb = b.recvs![0].from;
    if (fa !== fb) {
      return fail(a, b, ctx, `外部选择的发送方不一致（${fa} ≠ ${fb}），旁观方无法判断应等待哪一方`);
    }
    const labelsA = new Set(a.recvs!.map((r) => r.label));
    const overlap = b.recvs!.filter((r) => labelsA.has(r.label)).map((r) => r.label);
    if (overlap.length > 0) {
      return fail(a, b, ctx, `外部选择的标签重叠（${overlap.join('、')}）且后续行为不同，无法合并`);
    }
    return {
      kind: 'external',
      recvs: [...a.recvs!, ...b.recvs!],
      origin: unionOrigin(a.origin, b.origin),
      filled: true,
    };
  }
  if (a.kind === 'internal' && b.kind === 'internal') {
    return fail(a, b, ctx, '两支的发送行为（内部选择）不一致，无法合并');
  }
  const kindName = (n: LNode): string =>
    n.kind === 'end' ? '结束' : n.kind === 'internal' ? '发送（内部选择）' : '接收（外部选择）';
  return fail(a, b, ctx, `分支行为类别不一致（${kindName(a)} vs ${kindName(b)}），无法合并`);
}

function fail(a: LNode, b: LNode, ctx: MergeCtx | undefined, reason: string): never {
  if (!ctx) throw new Error(reason);
  throw new MergeFailure({
    participant: ctx.participant,
    choiceState: ctx.choiceState,
    reason,
    sides: [describeSide(a, ctx), describeSide(b, ctx)],
  });
}

function describeSide(node: LNode, ctx: MergeCtx): ConflictSide {
  return {
    states: node.origin ?? [],
    summary: summarize(node),
    path: sidePath(node, ctx),
  };
}

function summarize(node: LNode): string {
  if (node.kind === 'end') return '结束（无后续交互）';
  if (node.kind === 'internal') {
    return '主动发送：' + (node.sends ?? []).map((s) => `向 ${s.to} 发送「${s.label}」`).join('，');
  }
  return '被动接收：' + (node.recvs ?? []).map((r) => `从 ${r.from} 接收「${r.label}」`).join('，');
}

/** 从选择状态到该侧冲突点的代表路径，并附上触发冲突动作的那条迁移 */
function sidePath(node: LNode, ctx: MergeCtx): PathSeg[] {
  const choice = ctx.choiceState;
  if (node.kind === 'end') {
    return findPath(ctx.protocol, choice, node.origin?.[0] ?? choice);
  }
  const branch = node.kind === 'internal' ? node.sends![0] : node.recvs![0];
  const branchOrigin = branch.origin?.[0] ?? node.origin?.[0] ?? choice;
  const path = findPath(ctx.protocol, choice, branchOrigin);
  const witness = ctx.protocol.transitions.find((t) => {
    if (t.from !== branchOrigin) return false;
    if (node.kind === 'internal') {
      const s = branch as SendBranch;
      return t.sender === ctx.participant && t.receiver === s.to && t.label === s.label;
    }
    const r = branch as RecvBranch;
    return t.receiver === ctx.participant && t.sender === r.from && t.label === r.label;
  });
  if (witness) path.push({ from: witness.from, via: viaLabel(witness), to: witness.to });
  return path;
}

function viaLabel(t: Transition): string {
  return `${t.sender}→${t.receiver}: ${t.label}`;
}

/** 全局状态图上 from → to 的一条最短路径（BFS） */
export function findPath(p: Protocol, from: string, to: string): PathSeg[] {
  if (from === to) return [];
  const prev = new Map<string, { prevState: string; t: Transition }>();
  const seen = new Set<string>([from]);
  const queue: string[] = [from];
  while (queue.length > 0) {
    const s = queue.shift()!;
    for (const t of p.transitions) {
      if (t.from !== s || seen.has(t.to)) continue;
      seen.add(t.to);
      prev.set(t.to, { prevState: s, t });
      if (t.to === to) {
        const path: PathSeg[] = [];
        let cur = to;
        while (cur !== from) {
          const rec = prev.get(cur)!;
          path.unshift({ from: rec.t.from, via: viaLabel(rec.t), to: rec.t.to });
          cur = rec.prevState;
        }
        return path;
      }
      queue.push(t.to);
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// 投影
// ---------------------------------------------------------------------------

/** 把全局规程投影到单个参与方；失败时返回首个不可投影点（含分支路径）。 */
export function projectParticipant(
  p: Protocol,
  participant: string,
): { root?: LNode; error?: ProjectionError } {
  const byFrom = groupByFrom(p.transitions);
  const memo = new Map<string, LNode>();
  /** 被环（递归回边）引用过的占位节点：必须就地填充以保持同一对象 */
  const captured = new Set<LNode>();

  function proj(state: string): LNode {
    const existing = memo.get(state);
    if (existing) {
      if (isUnfilled(existing)) captured.add(existing);
      return existing;
    }
    // 先放占位节点再递归，环（递归）会指回同一节点
    const node: LNode = { kind: 'end', origin: [state], filled: false };
    memo.set(state, node);
    const ts = byFrom.get(state) ?? [];
    if (ts.length > 0) {
      const sender = ts[0].sender; // 校验已保证每个选择拥有唯一发送方
      if (participant === sender) {
        node.kind = 'internal';
        node.sends = ts.map((t) => ({ to: t.receiver, label: t.label, cont: proj(t.to), origin: [state] }));
        node.filled = true;
        return node;
      }
      let acc: LNode | undefined;
      for (const t of ts) {
        const branch: LNode =
          participant === t.receiver
            ? {
                kind: 'external',
                recvs: [{ from: sender, label: t.label, cont: proj(t.to), origin: [state] }],
                origin: [state],
                filled: true,
              }
            : proj(t.to);
        acc = acc === undefined ? branch : merge(acc, branch, { protocol: p, participant, choiceState: state });
      }
      const merged = acc!;
      if (merged !== node) {
        if (!captured.has(node)) {
          // 占位节点未被任何环引用：直接复用合并结果，避免冗余的一层展开
          memo.set(state, merged);
          return merged;
        }
        node.kind = merged.kind;
        node.sends = merged.sends;
        node.recvs = merged.recvs;
        node.origin = merged.origin;
      }
      // merged === node：该参与方在环中无任何动作（μt.t），保持 end
    }
    node.filled = true;
    return node;
  }

  try {
    return { root: proj(p.initial) };
  } catch (e) {
    if (e instanceof MergeFailure) return { error: e.projError };
    throw e;
  }
}

// ---------------------------------------------------------------------------
// 本地状态机提取
// ---------------------------------------------------------------------------

/** 把（可能有环的）局部类型图展开为有限状态机视图。 */
export function toLocalMachine(root: LNode, participant: string): LocalMachine {
  const ids = new Map<LNode, string>();
  const states: LocalState[] = [];
  const transitions: LocalTransition[] = [];
  const queue: LNode[] = [root];
  ids.set(root, 'L0');
  while (queue.length > 0) {
    const node = queue.shift()!;
    const id = ids.get(node)!;
    states.push({ id, kind: node.kind });
    const branches: Array<{ dir: 'send' | 'recv'; peer: string; label: string; cont: LNode }> =
      node.kind === 'internal'
        ? (node.sends ?? []).map((s) => ({ dir: 'send' as const, peer: s.to, label: s.label, cont: s.cont }))
        : node.kind === 'external'
          ? (node.recvs ?? []).map((r) => ({ dir: 'recv' as const, peer: r.from, label: r.label, cont: r.cont }))
          : [];
    for (const b of branches) {
      let toId = ids.get(b.cont);
      if (toId === undefined) {
        toId = `L${ids.size}`;
        ids.set(b.cont, toId);
        queue.push(b.cont);
      }
      transitions.push({ from: id, dir: b.dir, peer: b.peer, label: b.label, to: toId });
    }
  }
  return { participant, initial: 'L0', states, transitions, type: toTypeExpr(root) };
}

/** 局部类型的 μ 表达式：环上的回边以变量 X1、X2… 表示。 */
export function toTypeExpr(root: LNode): string {
  const names = new Map<LNode, string>();
  const open = new Set<LNode>();
  let counter = 0;
  const nameFor = (n: LNode): string => {
    let name = names.get(n);
    if (!name) {
      name = `X${++counter}`;
      names.set(n, name);
    }
    return name;
  };
  function go(node: LNode): string {
    if (node.kind === 'end') return 'end';
    if (open.has(node)) return nameFor(node);
    open.add(node);
    let body: string;
    if (node.kind === 'internal') {
      body = '⊕{ ' + (node.sends ?? []).map((s) => `${s.to}!${s.label}. ${go(s.cont)}`).join(', ') + ' }';
    } else {
      body = '&{ ' + (node.recvs ?? []).map((r) => `${r.from}?${r.label}. ${go(r.cont)}`).join(', ') + ' }';
    }
    open.delete(node);
    return names.has(node) ? `μ${names.get(node)}. ${body}` : body;
  }
  return go(root);
}

// ---------------------------------------------------------------------------
// 复核入口
// ---------------------------------------------------------------------------

/** 复核：先录入校验，再逐参与方投影；任一失败即按状态深度给出首个不可投影点。 */
export function verifyProtocol(p: Protocol): VerifyResult {
  const validationErrors = validateProtocol(p);
  if (validationErrors.length > 0) return { ok: false, validationErrors };

  const errors: ProjectionError[] = [];
  const machines: LocalMachine[] = [];
  for (const participant of p.participants) {
    const { root, error } = projectParticipant(p, participant);
    if (error) errors.push(error);
    else machines.push(toLocalMachine(root!, participant));
  }
  if (errors.length > 0) {
    const depth = bfsDepth(p);
    const order = new Map(p.participants.map((x, i) => [x, i]));
    errors.sort(
      (a, b) =>
        (depth.get(a.choiceState) ?? 0) - (depth.get(b.choiceState) ?? 0) ||
        (order.get(a.participant) ?? 0) - (order.get(b.participant) ?? 0),
    );
    return { ok: false, errors };
  }
  return { ok: true, machines };
}

function bfsDepth(p: Protocol): Map<string, number> {
  const depth = new Map<string, number>([[p.initial, 0]]);
  const queue: string[] = [p.initial];
  while (queue.length > 0) {
    const s = queue.shift()!;
    for (const t of p.transitions) {
      if (t.from === s && !depth.has(t.to)) {
        depth.set(t.to, depth.get(s)! + 1);
        queue.push(t.to);
      }
    }
  }
  return depth;
}
