export const agentPreferencesKey = 'verdboard.agent-settings';
export const agentNames = { codex: 'Codex' } as const;
export type AgentId = keyof typeof agentNames;

export function readDefaultAgent(): AgentId {
  try {
    const stored = JSON.parse(
      localStorage.getItem(agentPreferencesKey) ?? 'null',
    );
    const id: unknown = stored?.defaultAgent;
    if (typeof id === 'string' && Object.hasOwn(agentNames, id))
      return id as AgentId;
  } catch {
    // Missing storage or invalid preferences use the built-in default.
  }
  return 'codex';
}

export function setDefaultAgent(defaultAgent: AgentId) {
  try {
    localStorage.setItem(agentPreferencesKey, JSON.stringify({ defaultAgent }));
  } catch {
    // The built-in default is still available when storage is unavailable.
  }
}

export const agentLaunchLabel = (locale: 'zh' | 'en') =>
  locale === 'zh' ? '发起 Agent' : 'Start Agent';
