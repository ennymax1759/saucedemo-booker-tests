import process from 'node:process';

export function readPublishPolicy(env = process.env) {
 const mode = env.TESTPILOT_PUBLISH?.trim() || 'required';
 if (mode === '0') return 'local-only';
 if (mode === '1') return 'required';
 if (['required', 'best-effort', 'local-only'].includes(mode)) return mode;
 throw new Error('Set TESTPILOT_PUBLISH to required, best-effort, or local-only.');
}
