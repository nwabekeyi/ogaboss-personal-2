import { getPagination } from './pagination';
import { Prisma} from '../../infrastructure/databases/prisma'

export type DateRange = 'all' | '7' | '30' | '90' | '180' | '365';

export interface BaseQueryParams<
  T extends Record<string, any>,
  TInclude = any,
> {
  page?: number;
  limit?: number;
  search?: string;
  searchFields?: (keyof T)[];
  dateField?: keyof T & string;
  filters?: {
    [K in keyof T]?:
      | T[K]
      | {
          equals?: T[K];
          contains?: string;
          in?: T[K][];
          // Add other Prisma filter operators as needed
        };
  } & {
    dateRange?: DateRange;
    startDate?: Date;
    endDate?: Date;
  };
  include?: TInclude;
  sortBy?: keyof T;
  sortOrder?: 'asc' | 'desc';
}

interface FilterOptions {
  dateRange?: DateRange;
  startDate?: Date;
  endDate?: Date;
}

export function buildQueryOptions<
  T extends Record<string, any>,
  TInclude = any,
>(
  query: BaseQueryParams<T, TInclude>,
  options?: {
    defaultDateField?: keyof T;
    defaultSortBy?: keyof T;
    searchMode?: Prisma.QueryMode;
  },
) {
  const {
    page = 1,
    limit: _limit = 10,
    search,
    searchFields = [],
    dateField = options?.defaultDateField || 'createdAt',
    filters = {} as Partial<T> & FilterOptions,
    include = {} as TInclude,
    sortBy = options?.defaultSortBy || 'createdAt',
    sortOrder = 'desc',
  } = query || {};

  const { skip, limit } = getPagination(page, _limit);

  // Create a type-safe where clause
  const where: Prisma.JsonObject = { ...filters };

  // Handle date filtering
  if (filters.dateRange || (filters.startDate && filters.endDate)) {
    let dateFilter: Record<string, any> = {};

    if (filters.dateRange && filters.dateRange !== 'all') {
      const days = parseInt(filters.dateRange);
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);

      dateFilter = {
        [dateField]: {
          gte: fromDate,
        },
      };
    } else if (filters.startDate && filters.endDate) {
      dateFilter = {
        [dateField]: {
          gte: new Date(filters.startDate),
          lte: new Date(filters.endDate),
        },
      };
    }

    Object.assign(where, dateFilter);
  }

  // Clean up temporary filter properties
  delete where.dateRange;
  delete where.startDate;
  delete where.endDate;

  // Handle search
  if (search && searchFields.length > 0) {
    where.OR = searchFields.map((field) => ({
      [field]: {
        contains: search,
        mode: options?.searchMode || 'insensitive',
      },
    }));
  }

  return {
    where,
    orderBy: {
      [sortBy]: sortOrder,
    },
    skip,
    take: limit,
    include,
  };
}

// Helper function to create type-safe query params for specific models
export function createModelQuery<T, TInclude = any>(options?: {
  defaultDateField?: keyof T;
  defaultSortBy?: keyof T;
  searchMode?: Prisma.QueryMode;
}) {
  return (query: BaseQueryParams<T, TInclude>) =>
    buildQueryOptions<T, TInclude>(query, options);
}
