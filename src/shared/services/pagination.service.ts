import { PaginationMetaData } from '../../common/types';

export class PaginationService {
  public static getPagination = (
    page: number,
    pageSize: number,
    itemsCount: number,
  ): PaginationMetaData => {
    return {
      page,
      pageSize,
      itemsCount,
      totalPage: Math.ceil(itemsCount / pageSize),
    };
  };
}
