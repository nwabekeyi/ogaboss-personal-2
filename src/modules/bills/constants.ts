import { QUOTE_TTL_SECONDS } from '../transaction/constants';

export const BILL_CATEGORIES = [
  { id: 'cat_airtime', key: 'airtime', label: 'Airtime' },
  { id: 'cat_tv_subscription', key: 'tv_subscription', label: 'TV Subscription' },
  { id: 'cat_data', key: 'data', label: 'Data' },
  { id: 'cat_electricity', key: 'electricity', label: 'Electricity' },
  { id: 'cat_betting', key: 'betting', label: 'Betting' },
] as const;

export const BILL_QUOTE_TTL_SECONDS = QUOTE_TTL_SECONDS;
export const BILL_QUOTE_KEY_PREFIX = 'bill:quote:';