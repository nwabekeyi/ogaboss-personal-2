export function isDedicatedSchedulerRuntime(): boolean {
    const role = (process.env.APP_RUNTIME_ROLE || process.env.RUNTIME_ROLE || '')
      .trim()
      .toLowerCase();
    const enabled = (process.env.ENABLE_SCHEDULERS || '')
      .trim()
      .toLowerCase();
  
    return role === 'scheduler' || enabled === 'true' || enabled === '1';
  }