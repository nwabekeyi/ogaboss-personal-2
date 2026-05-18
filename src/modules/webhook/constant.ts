export const backoff_retries = 10;

export const BackoffTypes = {
    FIXED: 'fixed',
    EXPONENTIAL: 'exponential',
  } as const;
  
  // create a type from the values
  export type BackoffType = typeof BackoffTypes[keyof typeof BackoffTypes];