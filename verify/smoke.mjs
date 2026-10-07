#!/usr/bin/env node
/**
 * HTTP 冒烟：对运行中的服务检查健康地址、页面与内置演练结果。
 * 环境变量 APP_URL 指定目标（默认 http://localhost:8080）。
 * 全部通过以退出码 0 结束，否则退出码 1。
 */
const APP_URL = (process.env.APP_URL || 'http://localhost:8080').replace(/\/+$/, '');

let failures = 0;

function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  ✔ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✘ ${name}${detail ? ` —— ${detail}` : ''}`);
  }
}

async function waitForApp(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${APP_URL}/health`);
      if (res.ok) return true;
    } catch {
      // 尚未就绪，继续等待
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function getJson(path, init) {
  const res = await fetch(`${APP_URL}${path}`, init);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function main() {
  console.log(`[smoke] 目标服务: ${APP_URL}`);
  if (!(await waitForApp())) {
    console.error(`[smoke] 服务在 60s 内未就绪`);
    process.exit(1);
  }

  console.log('[smoke] 1/4 健康地址');
  const health = await getJson('/health');
  check('GET /health 返回 200', health.status === 200, `实际 ${health.status}`);
  check('健康响应 status 为 ok', health.body?.status === 'ok', JSON.stringify(health.body));

  console.log('[smoke] 2/4 页面');
  const page = await fetch(`${APP_URL}/`);
  const html = await page.text();
  check('GET / 返回 200', page.status === 200, `实际 ${page.status}`);
  check('页面包含 React 挂载点', html.includes('id="root"'));

  console.log('[smoke] 3/4 内置演练结果');
  const drills = await getJson('/api/drills');
  check('GET /api/drills 返回 200', drills.status === 200, `实际 ${drills.status}`);
  const list = drills.body?.drills ?? [];
  check('返回两个内置演练', list.length === 2, `实际 ${list.length}`);
  const d1 = list.find((d) => d.id === 'drill-merge');
  const d2 = list.find((d) => d.id === 'drill-conflict');
  check('演练一（同发送方不同标签）通过', d1?.result?.ok === true, JSON.stringify(d1?.result)?.slice(0, 300));
  check('演练一给出 3 个参与方的本地状态机', (d1?.result?.machines?.length ?? 0) === 3);
  check('演练二（C 等待不同发送方）被拒绝', d2?.result?.ok === false);
  const cErr = d2?.result?.errors?.find((e) => e.participant === 'C');
  check('演练二定位到参与方 C 在 S0 的不可投影点', cErr?.choiceState === 'S0', JSON.stringify(cErr)?.slice(0, 300));
  check(
    '演练二展示两条不可合并路径',
    Array.isArray(cErr?.sides) &&
      cErr.sides.length === 2 &&
      cErr.sides.every((s) => Array.isArray(s.path) && s.path.length >= 1 && s.summary),
  );

  console.log('[smoke] 4/4 复核接口');
  const post = (p) =>
    getJson('/api/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(p),
    });
  if (d1 && d2) {
    const r1 = await post(d1.protocol);
    check('POST /api/verify 演练一通过', r1.status === 200 && r1.body?.ok === true);
    const r2 = await post(d2.protocol);
    check('POST /api/verify 演练二拒绝', r2.status === 200 && r2.body?.ok === false);
  } else {
    check('内置演练齐全，可重放复核', false);
  }
  const bad = await post({
    participants: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
    states: ['S0'],
    initial: 'S0',
    transitions: [],
  });
  check(
    '超限录入返回校验错误',
    bad.status === 200 && Array.isArray(bad.body?.validationErrors) && bad.body.validationErrors.length > 0,
  );

  if (failures > 0) {
    console.error(`[smoke] 共 ${failures} 项未通过`);
    process.exit(1);
  }
  console.log('[smoke] 全部通过');
  process.exit(0);
}

main().catch((e) => {
  console.error('[smoke] 执行异常', e);
  process.exit(1);
});
