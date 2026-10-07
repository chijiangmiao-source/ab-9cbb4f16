import { useEffect, useMemo, useState } from 'react';
import type { Protocol, Transition } from '../../shared/model';
import type { LocalMachine, PathSeg, ProjectionError, VerifyResult } from '../../shared/engine';
import { fetchDrills, verify, type DrillWithResult } from './api';

const MAX_PARTICIPANTS = 6;
const MAX_STATES = 12;
const MAX_TRANSITIONS = 48;

const KIND_LABEL: Record<LocalMachine['states'][number]['kind'], string> = {
  end: '结束',
  internal: '内部选择 ⊕',
  external: '外部选择 &',
};

export default function App() {
  const [participants, setParticipants] = useState<string[]>(['A', 'B', 'C']);
  const [states, setStates] = useState<string[]>(['S0', 'S1', 'S2', 'S3']);
  const [initial, setInitial] = useState('S0');
  const [rows, setRows] = useState<Transition[]>([
    { from: 'S0', sender: 'A', receiver: 'B', label: 'x', to: 'S1' },
    { from: 'S0', sender: 'A', receiver: 'B', label: 'y', to: 'S2' },
    { from: 'S1', sender: 'B', receiver: 'C', label: 'l1', to: 'S3' },
    { from: 'S2', sender: 'B', receiver: 'C', label: 'l2', to: 'S3' },
  ]);
  const [newParticipant, setNewParticipant] = useState('');
  const [newState, setNewState] = useState('');
  const [drills, setDrills] = useState<DrillWithResult[]>([]);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchDrills()
      .then((d) => setDrills(d.drills))
      .catch(() => setDrills([]));
  }, []);

  /** 每个源状态的出度：>1 即构成选择，其迁移为选择分支 */
  const exitCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.from, (m.get(r.from) ?? 0) + 1);
    return m;
  }, [rows]);

  function loadDrill(d: DrillWithResult) {
    setParticipants([...d.protocol.participants]);
    setStates([...d.protocol.states]);
    setInitial(d.protocol.initial);
    setRows(d.protocol.transitions.map((t) => ({ ...t })));
    setResult(d.result ?? null);
    setClientError(null);
  }

  function addParticipant() {
    const name = newParticipant.trim();
    if (!name || participants.includes(name) || participants.length >= MAX_PARTICIPANTS) return;
    setParticipants([...participants, name]);
    setNewParticipant('');
  }

  function removeParticipant(name: string) {
    setParticipants(participants.filter((p) => p !== name));
  }

  function addState() {
    const name = newState.trim();
    if (!name || states.includes(name) || states.length >= MAX_STATES) return;
    setStates([...states, name]);
    if (!initial) setInitial(name);
    setNewState('');
  }

  function removeState(name: string) {
    const next = states.filter((s) => s !== name);
    setStates(next);
    if (initial === name) setInitial(next[0] ?? '');
  }

  function addRow() {
    if (rows.length >= MAX_TRANSITIONS || states.length === 0 || participants.length === 0) return;
    setRows([
      ...rows,
      {
        from: initial || states[0],
        sender: participants[0],
        receiver: participants[1] ?? participants[0],
        label: `m${rows.length + 1}`,
        to: initial || states[0],
      },
    ]);
  }

  function updateRow(i: number, patch: Partial<Transition>) {
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  function removeRow(i: number) {
    setRows(rows.filter((_, j) => j !== i));
  }

  async function onVerify() {
    setBusy(true);
    setClientError(null);
    try {
      const protocol: Protocol = { participants, states, initial, transitions: rows };
      setResult(await verify(protocol));
    } catch (e) {
      setResult(null);
      setClientError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="hero">
        <h1>递归会话规程投影复核器</h1>
        <p>
          在规程分发到各岗位前，确认递归会话规程能被每个参与方无歧义地投影为本地交互：
          每个选择拥有唯一发送方、递归状态受消息守卫、旁观方在各分支上的行为可合并为同一发送方驱动且标签不重叠的外部选择，
          递归局部类型按协归比较。
        </p>
      </header>

      <section className="card">
        <h2>内置演练</h2>
        <div className="drills">
          {drills.map((d) => (
            <button key={d.id} type="button" className="drill" onClick={() => loadDrill(d)}>
              <span className="drill-name">{d.name}</span>
              <span className={`badge ${d.expect === 'pass' ? 'badge-ok' : 'badge-bad'}`}>
                {d.expect === 'pass' ? '应通过' : '应拒绝'}
              </span>
              <span className="drill-desc">{d.description}</span>
            </button>
          ))}
          {drills.length === 0 && <span className="muted">演练加载中或后端未连接……</span>}
        </div>
      </section>

      <section className="card">
        <h2>
          参与方 <span className="count">{participants.length}/{MAX_PARTICIPANTS}</span>
        </h2>
        <div className="chips">
          {participants.map((p) => (
            <span key={p} className="chip">
              {p}
              <button type="button" aria-label={`移除 ${p}`} onClick={() => removeParticipant(p)}>✕</button>
            </span>
          ))}
          <input
            value={newParticipant}
            placeholder="新参与方"
            onChange={(e) => setNewParticipant(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addParticipant()}
          />
          <button type="button" onClick={addParticipant} disabled={participants.length >= MAX_PARTICIPANTS}>
            添加
          </button>
        </div>
      </section>

      <section className="card">
        <h2>
          具名状态 <span className="count">{states.length}/{MAX_STATES}</span>
        </h2>
        <div className="chips">
          {states.map((s) => (
            <span key={s} className={`chip ${s === initial ? 'chip-initial' : ''}`} title={s === initial ? '初始状态' : undefined}>
              {s}
              {s === initial && <em>（初始）</em>}
              <button type="button" aria-label={`移除 ${s}`} onClick={() => removeState(s)}>✕</button>
            </span>
          ))}
          <input
            value={newState}
            placeholder="新状态"
            onChange={(e) => setNewState(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addState()}
          />
          <button type="button" onClick={addState} disabled={states.length >= MAX_STATES}>
            添加
          </button>
        </div>
        <label className="field">
          初始状态
          <select value={initial} onChange={(e) => setInitial(e.target.value)}>
            {states.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="card">
        <h2>
          消息 / 选择分支 <span className="count">{rows.length}/{MAX_TRANSITIONS}</span>
        </h2>
        <p className="muted">同一状态发出多条迁移即构成一个选择；这些迁移即该选择的各分支。</p>
        <table className="grid">
          <thead>
            <tr>
              <th>#</th>
              <th>类型</th>
              <th>源状态</th>
              <th>发送方</th>
              <th>接收方</th>
              <th>标签</th>
              <th>目标状态</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>
                  <span className={`badge ${(exitCount.get(r.from) ?? 0) > 1 ? 'badge-branch' : 'badge-msg'}`}>
                    {(exitCount.get(r.from) ?? 0) > 1 ? '选择分支' : '消息'}
                  </span>
                </td>
                <td>
                  <select value={r.from} onChange={(e) => updateRow(i, { from: e.target.value })}>
                    {states.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td>
                  <select value={r.sender} onChange={(e) => updateRow(i, { sender: e.target.value })}>
                    {participants.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </td>
                <td>
                  <select value={r.receiver} onChange={(e) => updateRow(i, { receiver: e.target.value })}>
                    {participants.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </td>
                <td>
                  <input value={r.label} onChange={(e) => updateRow(i, { label: e.target.value })} />
                </td>
                <td>
                  <select value={r.to} onChange={(e) => updateRow(i, { to: e.target.value })}>
                    {states.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td>
                  <button type="button" onClick={() => removeRow(i)}>删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="actions">
          <button type="button" onClick={addRow} disabled={rows.length >= MAX_TRANSITIONS}>
            添加迁移
          </button>
          <button type="button" className="primary" onClick={onVerify} disabled={busy}>
            {busy ? '复核中……' : '复核'}
          </button>
        </div>
      </section>

      {clientError && (
        <section className="card result-bad">
          <h2>请求失败</h2>
          <p>{clientError}</p>
        </section>
      )}

      {result?.validationErrors && (
        <section className="card result-warn">
          <h2>录入校验未通过</h2>
          <ul>
            {result.validationErrors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </section>
      )}

      {result?.errors && (
        <section className="card result-bad">
          <h2>复核未通过：存在不可投影点</h2>
          {result.errors.map((e, i) => (
            <ErrorCard key={i} error={e} first={i === 0} />
          ))}
        </section>
      )}

      {result?.machines && (
        <section className="card result-ok">
          <h2>复核通过：{result.machines.length} 个参与方的规范本地状态机</h2>
          <div className="machines">
            {result.machines.map((m) => (
              <MachineCard key={m.participant} machine={m} />
            ))}
          </div>
        </section>
      )}

      <footer className="muted">
        复核规则：每个选择拥有唯一发送方 · 递归状态受消息守卫 · 旁观方各分支可合并为同一发送方驱动且标签不重叠的外部选择 ·
        递归局部类型按协归比较（名称不同但行为相同的环不视为冲突）
      </footer>
    </div>
  );
}

function ErrorCard({ error, first }: { error: ProjectionError; first: boolean }) {
  return (
    <div className="error-card">
      <h3>
        {first ? '首个不可投影点' : '不可投影点'}：参与方 <b>{error.participant}</b> @ 状态 <b>{error.choiceState}</b>
      </h3>
      <p className="reason">{error.reason}</p>
      <div className="sides">
        {error.sides.map((side, i) => (
          <div key={i} className="side">
            <div className="side-title">分支路径 {i + 1}</div>
            <PathView path={side.path} />
            <div className="side-summary">{side.summary}</div>
            {side.states.length > 0 && <div className="muted">来源状态：{side.states.join('、')}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function PathView({ path }: { path: PathSeg[] }) {
  if (path.length === 0) return <div className="path muted">（选择状态本身）</div>;
  return (
    <div className="path">
      <b>{path[0].from}</b>
      {path.map((seg, i) => (
        <span key={i} className="path-seg">
          <i>—[{seg.via}]→</i>
          <b>{seg.to}</b>
        </span>
      ))}
    </div>
  );
}

function MachineCard({ machine }: { machine: LocalMachine }) {
  const kindOf = (id: string) => machine.states.find((s) => s.id === id)?.kind ?? 'end';
  return (
    <div className="machine">
      <h3>参与方 {machine.participant}</h3>
      <div className="type-expr">
        <code>{machine.type}</code>
      </div>
      <div className="states">
        {machine.states.map((s) => (
          <span key={s.id} className={`chip chip-${s.kind}`}>
            {s.id} · {KIND_LABEL[s.kind]}
          </span>
        ))}
      </div>
      {machine.transitions.length > 0 ? (
        <table className="grid">
          <thead>
            <tr>
              <th>状态</th>
              <th>方向</th>
              <th>对方</th>
              <th>标签</th>
              <th>后继</th>
            </tr>
          </thead>
          <tbody>
            {machine.transitions.map((t, i) => (
              <tr key={i}>
                <td>{t.from}</td>
                <td>{t.dir === 'send' ? '发送 !' : '接收 ?'}</td>
                <td>{t.peer}</td>
                <td>{t.label}</td>
                <td>{t.to}{t.to === t.from || kindOf(t.to) !== 'end' ? '' : '（结束）'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">该参与方无任何交互（end）。</p>
      )}
    </div>
  );
}
