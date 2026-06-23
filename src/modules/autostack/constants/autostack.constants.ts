import { AutoStackFrequencyDto } from '../dto/autostack.dto';

export const AUTOSTACK_QUOTE_TTL_SECONDS = 300;

export const AUTOSTACK_FREQUENCY_PERIOD_DAYS: Record<AutoStackFrequencyDto, number> = {
  [AutoStackFrequencyDto.DAILY]: 1,
  [AutoStackFrequencyDto.WEEKLY]: 7,
  [AutoStackFrequencyDto.MONTHLY]: 30,
};

export const AUTOSTACK_DEFAULT_PLAN_NAME = 'AutoStack Plan';