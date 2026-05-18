import { PaginationMetaData } from '../../common/types';


export interface PaginatedNotifications<T> {
    data: T[];
    meta: PaginationMetaData & {
      hasNextPage: boolean;
      hasPreviousPage: boolean;
    };
  }