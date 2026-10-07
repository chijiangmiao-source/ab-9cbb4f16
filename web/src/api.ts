import type { Protocol } from '../../shared/model';
import type { VerifyResult } from '../../shared/engine';
import type { Drill } from '../../shared/drills';

export type DrillWithResult = Drill & { result?: VerifyResult };

export async function fetchDrills(): Promise<{ drills: DrillWithResult[] }> {
  const res = await fetch('/api/drills');
  if (!res.ok) throw new Error(`演练加载失败：HTTP ${res.status}`);
  return (await res.json()) as { drills: DrillWithResult[] };
}

export async function verify(protocol: Protocol): Promise<VerifyResult> {
  const res = await fetch('/api/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(protocol),
  });
  if (!res.ok) throw new Error(`复核请求失败：HTTP ${res.status}`);
  return (await res.json()) as VerifyResult;
}
