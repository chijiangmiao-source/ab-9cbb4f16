import type { Protocol } from './model.js';

export interface Drill {
  id: string;
  name: string;
  description: string;
  /** 期望结论：pass 应通过，fail 应拒绝 */
  expect: 'pass' | 'fail';
  protocol: Protocol;
}

/**
 * 内置演练。
 *
 * 演练一：A 作出选择后，两支中均由 B 向 C 发送不同标签。
 * C 作为旁观方可把两支合并为「同一发送方 B 驱动、标签不重叠」的外部选择，应通过。
 *
 * 演练二：A 作出选择后，C 在一支等待 B、另一支等待 D。
 * 外部选择发送方不一致，C 在分支后无法判断下一条消息来自谁，必须拒绝并展示两条不可合并的路径。
 */
export const DRILLS: Drill[] = [
  {
    id: 'drill-merge',
    name: '演练一：同发送方不同标签（应通过）',
    description:
      'A 选择后，两支均由 B 向 C 发送不同标签（l1 / l2）。旁观方 C 可将两支合并为同一发送方驱动且标签不重叠的外部选择。',
    expect: 'pass',
    protocol: {
      participants: ['A', 'B', 'C'],
      states: ['S0', 'S1', 'S2', 'S3'],
      initial: 'S0',
      transitions: [
        { from: 'S0', sender: 'A', receiver: 'B', label: 'x', to: 'S1' },
        { from: 'S0', sender: 'A', receiver: 'B', label: 'y', to: 'S2' },
        { from: 'S1', sender: 'B', receiver: 'C', label: 'l1', to: 'S3' },
        { from: 'S2', sender: 'B', receiver: 'C', label: 'l2', to: 'S3' },
      ],
    },
  },
  {
    id: 'drill-conflict',
    name: '演练二：旁观方等待不同发送方（应拒绝）',
    description:
      'A 选择后，C 在一支等待 B 的 l1、另一支等待 D 的 l2。外部选择发送方不一致，无法合并，必须拒绝并展示两条路径。',
    expect: 'fail',
    protocol: {
      participants: ['A', 'B', 'C', 'D'],
      states: ['S0', 'S1', 'S2', 'S3'],
      initial: 'S0',
      transitions: [
        { from: 'S0', sender: 'A', receiver: 'B', label: 'x', to: 'S1' },
        { from: 'S0', sender: 'A', receiver: 'B', label: 'y', to: 'S2' },
        { from: 'S1', sender: 'B', receiver: 'C', label: 'l1', to: 'S3' },
        { from: 'S2', sender: 'D', receiver: 'C', label: 'l2', to: 'S3' },
      ],
    },
  },
];
