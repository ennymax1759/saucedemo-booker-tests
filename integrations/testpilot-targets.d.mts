type Target = {baseURL?: string; projectId?: string; runId?: string; environment?: string};
type ResolvedTarget = Required<Pick<Target, 'baseURL' | 'projectId' | 'runId'>> & {
 environment: string | undefined;
 name: string;
 usesLocalKey: boolean;
};

export function resolveTestpilotTarget(root: string, env: NodeJS.ProcessEnv, defaults?: Target): ResolvedTarget;
export function loadLocalTestpilotTarget(root: string): Target;
